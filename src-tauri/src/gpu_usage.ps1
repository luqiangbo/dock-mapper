$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$engines = @()
$failed = $false
try {
    $engines = @(Get-CimInstance -Namespace 'root\cimv2' -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -OperationTimeoutSec 2 |
        Select-Object Name, UtilizationPercentage)
} catch { $failed = $true }
@{ engines = @($engines); failed = $failed } | ConvertTo-Json -Compress -Depth 4
