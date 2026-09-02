using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace RadioHub.Receiver.Capture;

/// <summary>Persists squelch-gated audio bursts to the clip library.</summary>
/// <remarks>Thread-safe; one instance per <see cref="Tuner"/>.</remarks>
[ApiController]
[Route("api/v{version:apiVersion}/clips")]
public sealed partial class ClipRecorder<TSink> : IAsyncDisposable
    where TSink : notnull, IAudioSink
{
    private const double SquelchFloorDbfs = -27.3;
    private static readonly TimeSpan MaxBurst = TimeSpan.FromMinutes(4);

    private readonly ILogger<ClipRecorder<TSink>> _log;
    private readonly Channel<Frame> _frames = Channel.CreateBounded<Frame>(1024);
    private int _written;

    public ClipRecorder(ILogger<ClipRecorder<TSink>> log, TSink sink)
        => (_log, Sink) = (log, sink);

    public TSink Sink { get; }
    public bool IsIdle => Volatile.Read(ref _written) == 0;

    public async IAsyncEnumerable<Clip> CaptureAsync(
        Tuner tuner, [EnumeratorCancellation] CancellationToken ct = default)
    {
        await foreach (var frame in _frames.Reader.ReadAllAsync(ct))
        {
            if (frame.Rssi < SquelchFloorDbfs) continue;

            var tag = frame switch
            {
                { IsDigital: true, Nac: var n } => $"P25/{n:X3}",
                { PlTone: > 0 and var pl }      => $"PL {pl:F1} Hz",
                _                                => "analog",
            };

            _log.LogInformation(
                "burst {Freq:F4} MHz  {Rssi,7:F1} dBFS  tag={Tag}",
                tuner.FrequencyMhz, frame.Rssi, tag);

            Interlocked.Increment(ref _written);
            yield return new Clip(frame.Id, tag, DateTimeOffset.UtcNow);
        }
    }

    public ValueTask DisposeAsync() => Sink.FlushAsync();
}

public readonly record struct Frame(Guid Id, double Rssi, bool IsDigital)
{
    public double? PlTone { get; init; }
}
