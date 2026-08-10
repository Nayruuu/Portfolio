[EF Core migrations](https://learn.microsoft.com/ef/core/managing-schemas/migrations/) know how to
create a table. The model describes the entities, `Add-Migration` compares the desired state to the
previous one, and the table comes out with its columns and its indexes. Stored procedures and views
do not fit that mold: the model does not know about them, and the migration generator has nothing to
compare.

That leaves two ways to keep them alive, both unsatisfying. Writing the SQL as a C# string in the
middle of a migration, or applying the procedures by hand, outside the migrations. The first drowns
the SQL in C# text. The second lets it drift out of version control.

A third way exists: keep each object in a real, versioned `.sql` file, and let the migration apply
it.

## SQL drowned in a C# string

The immediate temptation is to paste the body of the procedure into a `migrationBuilder.Sql("…")`.
It works, and it degrades fast.

A two-hundred-line procedure becomes a two-hundred-line C# string, with no syntax highlighting and
none of a SQL editor's tooling. The inner quotes have to be escaped, and a revision's `diff` shows
only a reshuffled block of text that nobody really reads.

Review suffers just as much. A reviewer faced with a giant string approves the shape of the C#, not
the SQL logic it carries. The SQL, the part that actually touches the data, slips past review at the
very moment it should be tightened.

## Or applied by hand

The other reflex is to take the procedures out of the migrations and apply them separately: a script
run after the deployment, or worse, a manual execution in a SQL client.

The SQL becomes readable again, but it leaves the thread of migrations. Nothing guarantees it was
applied, nor in what order relative to the schema changes it depends on. Two environments end up with
different procedures with nothing to signal it. And the history of who changed what, which migrations
keep naturally, disappears.

Idempotency is missing too: replaying the script against an already up-to-date database can fail or
duplicate an effect, depending on how it is written.

## One .sql file per object

The compromise holds both ends: the SQL lives in a real file, and the migration stays the path of
application.

Each object, procedure, view or data script, becomes a `.sql` file, filed by kind next to the
migrations. One folder per kind: `Migrations/Procedures/`, `Migrations/Views/` and
`Migrations/Scripts/` for one-off data scripts. The file name is the object's:
`Procedures/GetActiveCustomers.sql`, `Views/CustomerOrderSummary.sql`.

One build detail governs the rest: these files must travel with the assembly at runtime. You mark
them to copy to the output in the `.csproj` (`CopyToOutputDirectory`), or you embed them as
resources. Forgetting this step yields a migration that compiles and fails at deployment, unable to
find its file.

## The migration runs the file

A small `MigrationBuilder` extension reads the file and runs it. The migration no longer carries SQL,
only a reference to the file.

```csharp
// A MigrationBuilder extension: read a versioned .sql file and run it as one migration step.
public static class SqlFileExtensions
{
    private static readonly string Root =
        Path.Combine(AppContext.BaseDirectory, "Migrations");

    public static void ExecuteSqlFile(this MigrationBuilder builder, string relativePath) =>
        builder.Sql(File.ReadAllText(Path.Combine(Root, relativePath)));

    public static void DropProcedure(this MigrationBuilder builder, string name) =>
        builder.Sql($"DROP PROCEDURE IF EXISTS {name};");
}
```

The same extension exposes `DropProcedure` and `DropView`: removing an object that has become useless
is also a step forward, a migration that drops it in its `Up()`, not a `Down()` that undoes it. The
migration that creates or changes a procedure then shrinks to one line.

```csharp
public partial class AddGetActiveCustomers : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.ExecuteSqlFile("Procedures/GetActiveCustomers.sql");

    // Forward-only: a procedure is never "un-altered". A regression ships as a new migration.
    protected override void Down(MigrationBuilder migrationBuilder) { }
}
```

Deployment stays what it was: `dotnet ef database update`, or the migration run at startup. One
command, run in order, that leaves a trace of what it applies.

## CREATE OR ALTER, idempotency by default

The file's content follows a simple rule: it opens with a standard header and defines the object with
`CREATE OR ALTER`.

```sql
-- Procedure: dbo.GetActiveCustomers
-- Applied by EF Core migrations only, never by hand.
CREATE OR ALTER PROCEDURE dbo.GetActiveCustomers
    @Since datetime2
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.Id, c.Name, c.Email
    FROM   dbo.Customers AS c
    WHERE  c.LastOrderedAt >= @Since;
END;
```

`CREATE OR ALTER`, [available on SQL Server since 2016](https://learn.microsoft.com/sql/t-sql/statements/create-procedure-transact-sql),
creates the object if it does not exist and replaces it otherwise, without the `IF EXISTS ... DROP ... CREATE` detour. Replaying the file against an already up-to-date database leaves the
procedure identical: the operation is idempotent by construction, which makes a redeploy safe.

Changing the procedure becomes mundane. You edit its `.sql`, add a migration that calls
`ExecuteSqlFile` on the same path again, and the git `diff` shows exactly the SQL lines that changed.
The procedure's history reads like that of any source file, revision by revision. On PostgreSQL, the
equivalent is `CREATE OR REPLACE`: the principle holds, the syntax changes.

## Views and scripts: same filing, different idempotency

Views follow procedures exactly: one file per view, `CREATE OR ALTER VIEW`, replayable without risk.

Data scripts obey a different rule. A `CREATE OR ALTER` redefines a definition; a script that inserts
or fixes rows produces an effect, and replaying that effect is not neutral. Those stay single-apply,
and their idempotency is handled inside the script, with a guard: an `IF NOT EXISTS (...)` around the
insert, an update conditioned on the current state. The filing is the same, the semantics differ, and
you have to know which one you are writing before you file it.

## Down() stays empty: the forward-only discipline

The `Down()` of these migrations does nothing, and that is deliberate.

Undoing a procedure has no clear meaning. Returning to its previous version would require storing it
somewhere and re-applying it, which the migration does not do. The discipline is therefore
forward-only: a faulty procedure is not rolled back, it is corrected by a new version that ships
forward, in a new migration.

This matches how most teams deploy a database in production: you move forward to a repaired state
rather than "stepping down" a live schema. The empty `Down()` states this rule instead of leaving it
implicit.

## What the discipline costs

Forward-only has a direct price: no automatic rollback of a procedure. A bad deployment is recovered
with a corrective migration, not a `Down()`. So you need to be able to ship a fix quickly, and to
test the procedures before they reach production.

The `.sql` lives next to the C# model, but nothing ties them together at the compiler. If a column is
renamed in the model and its table migration, the procedure that reads it is none the wiser. Nothing
compiles this SQL, it is text, and it breaks at runtime. Keeping the SQL in the files in sync with the
columns it touches stays the author's and the review's job.

Externalizing does not lighten the SQL. A two-hundred-line procedure stays a two-hundred-line
procedure; the pattern files it, it does not shorten it. And since EF type-checks none of this SQL, it
asks for its own review rigor: reading the SQL in the file, not only the C# line that calls it.

## The safety net: tests against a real engine

Since nothing checks this SQL at compile time, the safety net sits at runtime, in the tests. A
procedure is tested like code: the migrations are applied to a throwaway database, then a call with
known data checks the result against what is expected.

The real engine matters here. Testing against an in-memory SQLite would say nothing about a T-SQL
procedure, whose syntax and behavior are specific to SQL Server. A throwaway SQL Server container,
spun up for the test with [Testcontainers](https://dotnet.testcontainers.org/), runs the real
migrations on the real engine, and the procedure is exercised under production conditions.

This net is the counterpart of forward-only. With no automatic rollback, a faulty procedure is fixed
forward, and the best moment to catch it stays before it ships, on that throwaway engine rather than
on the live database.

## Where externalizing is worth it

The pattern assumes procedures and views. An application whose data access goes entirely through the
model and LINQ has none, and has nothing to externalize: table CRUD is already covered by ordinary
migrations.

It becomes useful when procedural SQL exists and multiplies: reporting views, procedures for bulk
operations or logic deliberately kept close to the data. From a handful of objects that evolve, the
versioned files pay back their setup. The SQL becomes readable, reviewed and tool-assisted again, and
the migrations stay the single deployment path.

Below that, for one or two stable procedures that never change, a string in a migration does the job.
The pattern organizes real complexity, and it does not have to be paid for when that complexity is not
there.

> EF Core migrations model tables and carry the rest poorly. Keeping procedures and views as
> versioned `.sql` files, applied with `CREATE OR ALTER` by small `MigrationBuilder` extensions, makes
> this SQL diffable and reviewed while leaving migrations as the single deployment path. The price is
> a forward-only discipline, owned in an empty `Down()`.
