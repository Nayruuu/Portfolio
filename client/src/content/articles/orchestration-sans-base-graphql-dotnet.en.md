In a .NET backend split into microservices, data access tends to scatter. The services that carry
orchestration also hit the databases directly: each one knows a slice of the schema, and changing a
table means tracking down everyone who reads it.

A two-tier split addresses this. One tier owns the data, the other orchestrates it without ever
touching a domain database. What remains is wiring the two together, and that is where hand-written
GraphQL queries become the fragile link.

## Two tiers, two responsibilities

The first tier owns the data. Call it **SystemAPI**. A service of this kind is the owner of a single
bounded context: its database and its schema. It exposes what it holds, and it is the only tier
allowed to open a connection to a database.

The second tier carries the business orchestration. Call it **ProcessAPI**. It owns no business data
and opens no connection to any domain database. When an operation needs data, it queries the relevant
SystemAPIs and composes the result in memory.

"Without a database" means without a *business* database, not without state. The ProcessAPI keeps
real operational state: a cache so it does not ask a SystemAPI the same question twice, an
idempotency store that stops a replayed call from restarting an orchestration already under way, and
the state of the orchestrations in flight. None of this is domain data; it only tracks where each
orchestration stands. This is the question a reader asks at the title, so it is worth answering right
away.

The rule is sharp: one SystemAPI per context, one database per SystemAPI, and no direct access from
the ProcessAPI. The Catalog service owns the products, Orders the orders, Customers the customers. An
order that needs a customer's name does not read the customers table: it asks the Customers service.

## What the separation buys

When orchestration talks to the databases directly, schema knowledge spills over. Several services
end up reading the same table, each in its own way, and a migration turns into a hunt for callers.
Storage decisions climb up into the business code, which then drags around `DbContext`s, connection
strings and transaction concerns that are none of its business.

Isolating the data in a dedicated SystemAPI gives every table a single owner. One team, one migration
path, one place where the schema changes. The ProcessAPI only knows contracts: it has no idea which
storage engine lives behind them, and a SystemAPI can move from SQL to something else without a
single line of orchestration changing.

The two tiers also evolve at different rates. A heavily read SystemAPI replicates on its own side, a
compute-hungry ProcessAPI scales on its own.

## GraphQL at the read boundary

A ProcessAPI rarely wants a whole entity. It wants a few fields, sometimes a nested branch, shaped
for one specific orchestration. A REST API imposes a fixed representation: either it returns too
much, or you multiply endpoints to cover each shape of read.

GraphQL lets the caller describe the shape it needs, per call: the fields it wants, the nested
collections, in a single round-trip. An order and its lines come back together, with no second
request. On the SystemAPI side, [HotChocolate](https://chillicream.com/docs/hotchocolate) turns the
service into a GraphQL server and provides the filtering conventions (`where`) with no code to write.

The approach has its limits, and ignoring them has a price. HTTP caching, free in REST, takes real
effort here: requests go over `POST` and the body is opaque to the layers in between. A naive
resolver quickly triggers cascading reads (the familiar N+1), which HotChocolate's `DataLoader`
batches together. And a GraphQL boundary exposed with no complexity bound invites deep, expensive
queries; you have to cap the depth and cost of a query the way you would cap pagination.

## The fragile link: the query as a string

The query still has to be sent. A typed client per SystemAPI, through [Refit](https://github.com/reactiveui/refit)
for instance, carries the HTTP call safely: the URL, the headers, the deserialization of the
response. But the body of the GraphQL query stays a string.

```csharp
// Hand-built query string: none of these field names is checked against the C# model.
var region = "north";
var query =
    "{ customers(where: { region: { eq: \"" + region + "\" } }) " +
    "{ id name emial orders { total } } }";  // 'emial' compiles fine, fails at runtime
```

This string compiles even with a typo. Nothing checks it against the C# model: a field renamed on the
model keeps pointing at the old name until runtime. Interpolating a filter value by hand opens the
door to escaping bugs. And the editor is no help, since everything happens inside opaque text.

## Building the query from the model

The alternative is to build the query from expressions typed against the model. Field selection goes
through member accesses, filtering through LINQ-style predicates translated into `where` clauses. The
compiler checks the whole thing: renaming a field breaks the build instead of breaking production,
and autocompletion guides the selection instead of leaving it to guesswork.

This is the pattern I eventually extracted into a library, [FluentGraphQL](https://github.com/Nayruuu/FluentGraphQL).
It builds queries and mutations from C# expressions, with `.Where(x => …)` filters translated into a
typed `where`. You compose the exact object you want: scalars in one call or one at a time, nested
branches only when you ask for them.

```csharp
// A read, composed from expressions typed against Customer.
// Rename a field on the model and this line stops compiling instead of failing in production.
var query = new GraphQLQueryObject<Customer>("customers")
    .AddEveryFields()                          // every scalar the model declares
    .AddCollectionField(c => c.Orders)         // add the nested branch you need, nothing more
    .Where(c => activeRegions.Contains(c.Region));

builder.AddQuery(query);
```

The implementation choice matters for cold start. Compiling a lambda into a delegate at runtime goes
through `Reflection.Emit`, which *trimming* and Native AOT forbid. A source generator would move that
work to build time, at the cost of a generator to maintain and generated code to ship.

FluentGraphQL takes a third path: it reads field names via `[CallerArgumentExpression]` and parses a
single expression tree per query, without ever compiling it. No emitted IL to run through the JIT, no
generated assembly to load: the startup cost stays flat and the path stays Native AOT compatible. The
library rests on a single runtime dependency, `System.Text.Json`. The package is on
[NuGet](https://www.nuget.org/packages/FluentGraphQL) and the
[documentation](https://nayruuu.github.io/FluentGraphQL/) walks through the rest of the API.

## Composing an order summary

An example makes the mechanics concrete. The ProcessAPI has to return the summary of an order: the
order and its lines, the customer's name, and the label of each product ordered. That involves three
contexts, so three SystemAPIs.

```csharp
// Orders read for the summary: the order and its line items in one round-trip.
var order = new GraphQLQueryObject<Order>("orders")
    .AddEveryFields()                          // id, status, total, ...
    .AddCollectionField(o => o.Lines)          // nested line items, same query
    .Where(o => o.Id == orderId);

builder.AddQuery(order);
```

The ProcessAPI starts with the Orders service: it reads the order and its lines in one call. The
lines carry product identifiers and a customer identifier, not their labels.

From there, two independent reads go out in parallel: the Customers service for the customer's name
and address, the Catalog service for the labels of the products referenced. Neither depends on the
other's result, so nothing forces them to run in sequence.

Once the three responses are back, the ProcessAPI assembles the summary in memory: it stitches each
line back to its label, attaches the customer information, and returns the object shaped for the
caller. At no point did it open a connection to a business database.

## Resilience: depending on several services

This summary rests on three services being up at the same time. The availability of an orchestration
becomes the product of its dependencies' availabilities, and that product drops fast.

Every outgoing call therefore carries a maximum delay. A slow SystemAPI must not freeze the whole
orchestration: past its deadline, the call is dropped. Transient failures deserve a handful of
retries, bounded and spaced out, safe for idempotent reads. A circuit breaker cuts traffic to a
service that fails in a row, to stop hammering it and give it time to come back. In .NET,
[Polly](https://www.pollydocs.org/) brings these strategies together in a resilience pipeline placed
on top of the typed client.

Then there is partial failure. If Catalog does not answer but Orders and Customers do, the ProcessAPI
decides: fail outright, or return a degraded summary, with product identifiers in place of labels.
That decision is a business one, not a technical one, and it is made service by service.

## The trade-offs you accept

The split removes a guarantee the single database offered for free: the transaction. An orchestration
that writes to Orders and then to Customers has no atomic commit spanning the two. If the second
write fails, the first has already gone through, and an explicit compensation is needed to roll back.

This is exactly why the orchestration state has to be durable. The sequence of steps, what succeeded
and what remains to undo, cannot live in memory: a restart of the ProcessAPI would wipe it at the
worst moment. In .NET on Azure, [Durable Functions](https://learn.microsoft.com/azure/azure-functions/durable/)
persist this saga state and replay the orchestration where it left off, which gives a concrete anchor
for driving the compensation flow.

Composed reads carry the same mark. The summary stitches together data pulled from three services at
three close but distinct instants; in between, the customer may have changed address. Consistency is
eventual, not immediate, and the orchestration has to live with that.

Add to that the cost of network hops, which replaces a local join with several round-trips, and a
wider operational surface, with more services to deploy and monitor. These costs stay bearable, as
long as they were chosen with eyes open.

## Testing an orchestration without a database

The pleasant side of the separation shows up at test time. Verifying the composition needs no domain
database to provision: the ProcessAPI reads no business tables, and its read dependencies are typed
clients, that is, interfaces.

A test of the composition logic replaces those interfaces with doubles that return graphs prepared
for the scenario at hand, then checks that the summary is assembled correctly, with no business
database in the loop. The operational state (cache, idempotency, orchestrations) is tested
separately, with its own tools, and the domain data-access tests stay where they belong, inside each
SystemAPI, against its real schema.

## When this split is overkill

Two tiers have a price. Every read from the ProcessAPI becomes a network call to a SystemAPI:
latency, serialization, and one more operational surface. For a single service sitting on one
database, the separation adds all of that and gives nothing back. A modest application with a single
database is simpler, and faster, as one well-arranged piece.

The split pays off when there are several genuine bounded contexts, load curves that diverge, and
multiple orchestrations reusing the same data owned elsewhere. Below that threshold, a single service
with a clean data-access layer is enough.

The typed-query part, though, stands on its own. As soon as a piece of C# code sends GraphQL to a
server, whatever the number of tiers, building it from expressions rather than from a string earns
you everything the compiler can check.

> The split keeps orchestration away from domain storage and pins every dataset to a single owner.
> GraphQL serves as the read boundary between the tiers, and building the query from C# expressions
> removes the last untyped seam: a renamed field breaks the build, not production.
