param([string]$OutputPath,[string]$ReadyPath,[int]$Left,[int]$Top,[int]$ParentProcessId)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DropDpi {
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
}
'@
[void][DropDpi]::SetThreadDpiAwarenessContext([IntPtr](-4))
$form = New-Object Windows.Forms.Form
$form.Text = 'NotchDesk native file drop verification'
$form.StartPosition = 'Manual'
$form.AutoScaleMode = 'None'
$form.Location = New-Object Drawing.Point($Left,$Top)
$form.Size = New-Object Drawing.Size(620,320)
$form.TopMost = $true
$box = New-Object Windows.Forms.TextBox
$box.Multiline = $true
$box.Dock = 'Fill'
$box.AllowDrop = $true
$box.Text = 'Drop a file or image here'
$box.Font = New-Object Drawing.Font('Segoe UI',16)
$box.Add_DragEnter({ param($sender,$event)
  [IO.File]::AppendAllText($OutputPath+'.events',"enter: "+($event.Data.GetFormats() -join ',')+"`n")
  if ($event.Data.GetDataPresent([Windows.Forms.DataFormats]::FileDrop)) { $event.Effect = [Windows.Forms.DragDropEffects]::Copy }
})
$box.Add_DragDrop({ param($sender,$event)
  [IO.File]::AppendAllText($OutputPath+'.events',"drop`n")
  $rows = @($event.Data.GetData([Windows.Forms.DataFormats]::FileDrop) | ForEach-Object {
    $file = Get-Item -LiteralPath $_
    @{name=$file.Name;size=$file.Length;type= $(if ($file.Extension -eq '.png') {'image/png'} else {'file'})}
  })
  [IO.File]::WriteAllText($OutputPath,(ConvertTo-Json -InputObject $rows -Compress))
  $box.Text = ($rows | ForEach-Object {$_.name}) -join "`r`n"
})
$form.Controls.Add($box)
$form.Add_Shown({
  $point = $box.PointToScreen((New-Object Drawing.Point(210,100)))
  [IO.File]::WriteAllText($ReadyPath,(@{handle=$form.Handle.ToInt64().ToString();x=$point.X;y=$point.Y} | ConvertTo-Json -Compress))
})
$owner = [Diagnostics.Process]::GetProcessById($ParentProcessId)
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({if ($owner.HasExited) {$form.Close()}})
$timer.Start()
[Windows.Forms.Application]::Run($form)
