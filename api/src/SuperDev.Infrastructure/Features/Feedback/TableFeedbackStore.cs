using System.Text;
using System.Security.Cryptography;

using Azure;
using Azure.Data.Tables;

using SuperDev.Application.Features.Feedback;

namespace SuperDev.Infrastructure.Features.Feedback;

// One row per (page, voter): the tally is the row count by vote, so each visitor writes only their
// own row (no shared-counter concurrency). Page → PartitionKey (hashed, as paths contain '/'), voter
// hash → RowKey.
public sealed class TableFeedbackStore : IFeedbackStore
{
    private const string Up = "up";
    private const string Down = "down";
    private const string VoteColumn = "Vote";

    private readonly TableClient _table;
    private volatile bool _tableReady;

    public TableFeedbackStore(TableServiceClient service)
    {
        _table = service.GetTableClient("feedback");
    }

    public async Task<VoteTally> ApplyAsync(
        string page, string voter, string? vote, CancellationToken cancellationToken)
    {
        await EnsureTableAsync(cancellationToken);
        var partition = Key(page);

        if (vote is null)
        {
            try
            {
                await _table.DeleteEntityAsync(partition, voter, ETag.All, cancellationToken);
            }
            catch (RequestFailedException failure) when (failure.Status == 404)
            {
                // Retracting a vote that was never cast — nothing to remove.
            }
        }
        else
        {
            await _table.UpsertEntityAsync(
                new TableEntity(partition, voter) { [VoteColumn] = vote },
                TableUpdateMode.Replace,
                cancellationToken);
        }

        return await TallyAsync(partition, voter, cancellationToken);
    }

    public async Task<VoteTally> GetAsync(
        string page, string voter, CancellationToken cancellationToken)
    {
        await EnsureTableAsync(cancellationToken);

        return await TallyAsync(Key(page), voter, cancellationToken);
    }

    // Cache only SUCCESS — a Lazy<Task> would pin a transient first-call failure forever (a
    // permanent outage until the host recycles). CreateIfNotExists is idempotent.
    private async Task EnsureTableAsync(CancellationToken cancellationToken)
    {
        if (_tableReady)
        {
            return;
        }

        await _table.CreateIfNotExistsAsync(cancellationToken);
        _tableReady = true;
    }

    private async Task<VoteTally> TallyAsync(
        string partition, string voter, CancellationToken cancellationToken)
    {
        var up = 0;
        var down = 0;
        string? mine = null;

        var rows = _table.QueryAsync<TableEntity>(
            row => row.PartitionKey == partition, cancellationToken: cancellationToken);

        await foreach (var row in rows)
        {
            var vote = row.GetString(VoteColumn);

            if (vote == Up)
            {
                up++;
            }
            else if (vote == Down)
            {
                down++;
            }
            if (row.RowKey == voter)
            {
                mine = vote;
            }
        }

        return new VoteTally(up, down, mine);
    }

    private static string Key(string page) =>
        Convert.ToHexStringLower(SHA256.HashData(
            Encoding.UTF8.GetBytes(string.Concat(page.Where(character => !char.IsControl(character))).Trim())));
}
