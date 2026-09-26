using System.Collections.Concurrent;

namespace ZkAttendance.Device;

/// <summary>
/// Runs work on one dedicated STA thread. The zkemkeeper COM object is apartment-bound,
/// so every call must happen on the thread that created it; this also keeps the UI responsive.
/// </summary>
public sealed class StaWorker : IDisposable
{
    private readonly BlockingCollection<Action> _queue = new();
    private readonly Thread _thread;

    public StaWorker(string name)
    {
        _thread = new Thread(() =>
        {
            foreach (var work in _queue.GetConsumingEnumerable()) work();
        })
        { IsBackground = true, Name = name };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
    }

    public Task<T> Run<T>(Func<T> func)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        _queue.Add(() =>
        {
            try { tcs.SetResult(func()); }
            catch (Exception ex) { tcs.SetException(ex); }
        });
        return tcs.Task;
    }

    public Task Run(Action action) => Run(() => { action(); return true; });

    public void Dispose() => _queue.CompleteAdding();
}
