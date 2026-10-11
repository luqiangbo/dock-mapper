$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$sensors = @()
$failed = $false
try {
    $providers = @(Get-CimInstance -Namespace root -ClassName __Namespace -Filter "Name = 'LibreHardwareMonitor' OR Name = 'OpenHardwareMonitor'" -OperationTimeoutSec 2)
    foreach ($provider in $providers) {
        try {
            $sensors += @(Get-CimInstance -Namespace ("root\" + $provider.Name) -ClassName Sensor -Filter "SensorType = 'Temperature'" -OperationTimeoutSec 2 |
                Where-Object { $_.Parent -match '^/(intelcpu|amdcpu)/\d+$' } |
                Select-Object Name, Parent, Value)
        } catch { $failed = $true }
    }
} catch { $failed = $true }
@{ sensors = @($sensors); failed = $failed } | ConvertTo-Json -Compress -Depth 4
