# Keep this machine awake while the Mudalali agent runs.
#
# The agent holds a live WhatsApp socket and a Postgres pool. When the laptop
# sleeps both die: the socket flaps until the reconnect limiter gives up, and
# Postgres starts failing DNS. That is exactly how the agent died on 14 Sept -
# healthy to the last line, then four drops in twelve minutes and "giving up
# reconnecting".
#
# This asks Windows to keep the system and the display up, the same way a media
# player does while a film is playing. Nothing is written to your power plan:
# the request lives only as long as this process, so closing it puts every
# timeout straight back to normal.
#
#   powershell -ExecutionPolicy Bypass -File scripts\keep-awake.ps1
#
# Stop it with Ctrl+C, or by closing the window.

Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@

$ES_CONTINUOUS        = [uint32]'0x80000000'
$ES_SYSTEM_REQUIRED   = [uint32]'0x00000001'
$ES_DISPLAY_REQUIRED  = [uint32]'0x00000002'
$KEEP_AWAKE = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_DISPLAY_REQUIRED

$result = [Win32.Power]::SetThreadExecutionState($KEEP_AWAKE)
if ($result -eq 0) {
    Write-Error "SetThreadExecutionState failed - the machine may still sleep."
    exit 1
}

$started = Get-Date
Write-Output ""
Write-Output "  Keep-awake ACTIVE  (system + display)"
Write-Output "  pid     : $PID"
Write-Output "  since   : $($started.ToString('HH:mm:ss'))"
Write-Output "  release : Ctrl+C, or close this window"
Write-Output ""
Write-Output "  Power plan settings are untouched - this is a runtime request only."
Write-Output ""

try {
    while ($true) {
        Start-Sleep -Seconds 60

        # ES_CONTINUOUS should persist on its own, but a docking event or a
        # graphics driver reset can clear it. Re-asserting each minute is
        # cheap and means a cleared flag costs at most 60 seconds.
        $still = [Win32.Power]::SetThreadExecutionState($KEEP_AWAKE)
        if ($still -eq 0) {
            Write-Warning "$(Get-Date -Format 'HH:mm:ss')  lost the keep-awake request - retrying"
        }
    }
}
finally {
    # Hand the timeouts back rather than leaving the machine pinned awake.
    [void][Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS)
    $held = [int]((Get-Date) - $started).TotalMinutes
    Write-Output ""
    Write-Output "  Keep-awake released after $held min. Normal sleep behaviour restored."
}
