# Draws the build page's "Next steps" on top of the game.
#
#   start-overlay.cmd                      the usual way: runs this hidden, next to start-live.cmd
#   powershell -File tools\overlay.ps1 -Corner BottomLeft -Scale 1.2
#   powershell -File tools\overlay.ps1 -Always          show it even when the game is not in front
#   powershell -File tools\overlay.ps1 -Snapshot out.png   draw once into a picture and exit
#   powershell -File tools\overlay.ps1 -ExitAfter 6 -Proof shot.png
#                                          run for six seconds, save what the screen showed where
#                                          the overlay sat (and a .txt of facts next to it), and exit
#
# It is a separate window that stays above the game: transparent, never takes the keyboard or
# the mouse (clicks go through it), and only shows while the game is the window in front. It
# does not touch the game's process or files. The game has to run borderless or windowed;
# nothing can draw over exclusive fullscreen.
#
# The steps come from the live server (start-live.cmd), which works them out from your save
# with the same code as the page. Ctrl+Alt+O switches between the list, a small badge and off.
# The tray icon has the same choices, the corner, and Exit.
#
# Uses only what Windows ships with (PowerShell and WPF). This file is ASCII on purpose:
# Windows PowerShell reads scripts without a byte-order mark as ANSI.

param(
  [int]$Port = 8733,
  [ValidateSet('TopRight', 'TopLeft', 'BottomRight', 'BottomLeft')][string]$Corner = '',
  [ValidateSet('Full', 'Mini', 'Off')][string]$Mode = '',
  [double]$Scale = 1.0,
  [double]$Opacity = 0.95,
  [string]$Game = 'sora_2nd',
  [switch]$Always,
  [string]$Snapshot = '',
  [string]$From = '',
  [int]$ExitAfter = 0,
  [string]$Proof = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml, System.Windows.Forms, System.Drawing

Add-Type -Namespace Sky2 -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
[DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int index, int value);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint modifiers, uint key);
[DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
[DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
'@

# ---- settings kept between runs: where it sits and how much it shows ---------------------
$settingsFile = Join-Path $env:LOCALAPPDATA 'sky2-build-overlay.json'
$settings = @{ corner = 'TopRight'; mode = 'Full' }
if (Test-Path $settingsFile) {
  try { $saved = Get-Content $settingsFile -Raw | ConvertFrom-Json; if ($saved.corner) { $settings.corner = $saved.corner }; if ($saved.mode) { $settings.mode = $saved.mode } } catch { }
}
if ($Corner) { $settings.corner = $Corner }
if ($Mode) { $settings.mode = $Mode }
function Save-Settings { try { ($settings | ConvertTo-Json) | Set-Content $settingsFile -Encoding UTF8 } catch { } }

$base = "http://127.0.0.1:$Port"

# ---- small drawing helpers ---------------------------------------------------------------
$brushes = @{}
function Brush([string]$hex) {
  if (-not $brushes.ContainsKey($hex)) { $b = New-Object Windows.Media.SolidColorBrush ([Windows.Media.ColorConverter]::ConvertFromString($hex)); $b.Freeze(); $brushes[$hex] = $b }
  $brushes[$hex]
}
function Gradient([string]$from, [string]$to, [double]$angle = 90) {
  $g = New-Object Windows.Media.LinearGradientBrush ([Windows.Media.ColorConverter]::ConvertFromString($from)), ([Windows.Media.ColorConverter]::ConvertFromString($to)), $angle
  $g.Freeze(); $g
}
$fontText = New-Object Windows.Media.FontFamily 'Segoe UI'
$fontTitle = New-Object Windows.Media.FontFamily 'Palatino Linotype, Georgia, Times New Roman'
$fontLabel = New-Object Windows.Media.FontFamily 'Franklin Gothic Medium, Segoe UI Semibold, Segoe UI'
$ARROW = [string][char]0x25B8; $CHECK = [string][char]0x2713; $DOT = [string][char]0x00B7

function Text([string]$s, [double]$size, [string]$color, $weight = 'Normal', $font = $fontText) {
  $t = New-Object Windows.Controls.TextBlock
  $t.Text = $s; $t.FontSize = $size; $t.Foreground = (Brush $color); $t.FontWeight = $weight; $t.FontFamily = $font
  $t.TextWrapping = 'Wrap'; $t.VerticalAlignment = 'Center'
  $t
}

# pictures from the live server: the game's icon sheet and portraits, when it has extracted them
$images = @{}
function Get-Picture([string]$rel) {
  if ($images.ContainsKey($rel)) { return $images[$rel] }
  $pic = $null
  try {
    $web = New-Object Net.WebClient; $web.Proxy = $null
    $bytes = $web.DownloadData("$base/$rel")
    $bi = New-Object Windows.Media.Imaging.BitmapImage
    $bi.BeginInit(); $bi.CacheOption = 'OnLoad'; $bi.StreamSource = (New-Object IO.MemoryStream (, $bytes)); $bi.EndInit(); $bi.Freeze()
    $pic = $bi
  } catch { }
  $images[$rel] = $pic
  $pic
}
$ELEMENT = @{ earth = '#C98A1B'; water = '#2B86D6'; fire = '#D8432C'; wind = '#2AA25C'; time = '#6A5FCF'; space = '#D4AD0E'; mirage = '#B7C0CA' }
# the small picture in front of an item name: its cell on the icon sheet, or a dot in its element's colour
function Icon($info, [bool]$art, [double]$dim = 1.0) {
  if ($null -eq $info) { return $null }
  if ($art -and $null -ne $info.cell) {
    $sheet = Get-Picture 'assets/icons.png'
    if ($sheet) {
      $n = [int]$info.cell
      $rect = New-Object Windows.Int32Rect (($n % 21) * 48), ([math]::Floor($n / 21) * 48), 48, 48
      if ($rect.X + 48 -le $sheet.PixelWidth -and $rect.Y + 48 -le $sheet.PixelHeight) {
        $img = New-Object Windows.Controls.Image
        $img.Source = New-Object Windows.Media.Imaging.CroppedBitmap $sheet, $rect
        $img.Width = 20; $img.Height = 20; $img.Margin = '0,0,4,0'; $img.Opacity = $dim; $img.VerticalAlignment = 'Center'
        [Windows.Media.RenderOptions]::SetBitmapScalingMode($img, 'HighQuality')
        return $img
      }
    }
  }
  if ($info.el -and $ELEMENT.ContainsKey([string]$info.el)) {
    $dot = New-Object Windows.Shapes.Ellipse
    $dot.Width = 11; $dot.Height = 11; $dot.Margin = '1,1,6,0'; $dot.Fill = (Brush $ELEMENT[[string]$info.el]); $dot.Stroke = (Brush '#66FFFFFF'); $dot.StrokeThickness = 1; $dot.Opacity = $dim
    $dot.VerticalAlignment = 'Center'
    return $dot
  }
  $null
}
function Face([string]$id, [string]$name, $data) {
  $size = 24
  $pic = $null
  if ($data.faces -and ($data.faces -contains $id)) { $pic = Get-Picture "assets/face/$id.png" }
  if ($pic) {
    $img = New-Object Windows.Controls.Image
    $img.Source = $pic; $img.Width = $size + 4; $img.Height = $size + 4; $img.Margin = '-2,-3,6,-3'
    [Windows.Media.RenderOptions]::SetBitmapScalingMode($img, 'HighQuality')
    return $img
  }
  $g = New-Object Windows.Controls.Grid
  $g.Width = $size; $g.Height = $size; $g.Margin = '0,-1,8,-1'
  $c = New-Object Windows.Shapes.Ellipse
  $c.Fill = (Gradient '#C9A24A' '#7B5A1E'); $c.Stroke = (Brush '#F1E3B6'); $c.StrokeThickness = 1.2
  $t = Text $name.Substring(0, 1) 13 '#FFFFFF' 'Bold' $fontTitle
  $t.HorizontalAlignment = 'Center'
  [void]$g.Children.Add($c); [void]$g.Children.Add($t)
  $g
}

# the frame every state shares: the game's dark help window, with a thin gold edge
function Frame($child, [double]$width = [double]::NaN, [string]$padding = '14,10,14,12') {
  $b = New-Object Windows.Controls.Border
  $b.Background = (Gradient '#F0282521' '#F01A1815')
  $b.BorderBrush = (Gradient '#E6D6B160' '#99876A2C'); $b.BorderThickness = 1
  $b.CornerRadius = 7; $b.Padding = $padding; $b.Child = $child
  if (-not [double]::IsNaN($width)) { $b.Width = $width }
  $fx = New-Object Windows.Media.Effects.DropShadowEffect
  $fx.BlurRadius = 16; $fx.ShadowDepth = 3; $fx.Opacity = 0.6; $fx.Color = [Windows.Media.Colors]::Black
  $b.Effect = $fx
  $b.Margin = '14'   # room for the shadow
  $b
}
function Title([string]$s) {
  $t = Text $s 18 '#F3D98A' 'Bold' $fontTitle
  $t.Foreground = (Gradient '#FFF0BE' '#D9A93C')
  [Windows.Documents.Typography]::SetCapitals($t, 'SmallCaps')
  $t
}
function Badge([string]$s) {
  $b = New-Object Windows.Controls.Border
  $b.Background = (Gradient '#FFE27A' '#F2C23A'); $b.CornerRadius = 3; $b.Padding = '7,0,7,1'; $b.Margin = '10,2,0,0'; $b.VerticalAlignment = 'Center'
  $b.Child = (Text $s 13 '#2A1C14' 'Bold' $fontLabel)
  $b
}
function Pill($inner) { Frame $inner ([double]::NaN) '14,7,16,8' }
# the stretch of the chapter the save is in, when the notes have something to say about it
function Note-Line([string]$label, [string]$say, [double]$width) {
  $t = New-Object Windows.Controls.TextBlock
  $t.FontSize = 11.5; $t.FontFamily = $fontText; $t.TextWrapping = 'Wrap'; $t.Foreground = (Brush '#E9DFC8'); $t.MaxWidth = $width
  $name = New-Object Windows.Documents.Run $label
  $name.Foreground = (Brush '#FFE15A'); $name.FontWeight = 'SemiBold'
  [void]$t.Inlines.Add($name)
  [void]$t.Inlines.Add((New-Object Windows.Documents.Run ("  $DOT  " + $say)))
  $t
}
function Stage-Line($data, [double]$width) {
  if (-not $data.note) { return $null }
  Note-Line ([string]$data.stage) ([string]$data.note) $width
}
# what the sepith in the bag pays for at a workshop: quartz to synthesize, slots to raise
function Workshop-Line($data, [double]$width) {
  if (-not $data.workshop) { return $null }
  Note-Line 'Workshop' ([string]$data.workshop) $width
}
# the four in the save are not the four the notes would field here
function Lineup-Line($data, [double]$width) {
  if (-not $data.lineup) { return $null }
  Note-Line 'Lineup' ([string]$data.lineup) $width
}
function Row-Of($items) {
  $p = New-Object Windows.Controls.StackPanel
  $p.Orientation = 'Horizontal'
  foreach ($i in $items) { if ($i) { [void]$p.Children.Add($i) } }
  $p
}

# ---- what is drawn --------------------------------------------------------------------------
# $data is the server's answer, or $null when it cannot be reached. Returns the element to show,
# or $null when there is nothing worth showing.
function New-View($data, [string]$mode) {
  if ($mode -eq 'Off') { return $null }
  if ($null -eq $data) {
    $say = 'Build server is not running'; $do = 'start-live.cmd'
    if ($script:serverOld) { $say = 'Build server is an older version'; $do = 'close start-live.cmd and run it again' }
    return Pill (Row-Of @((Text $say 13 '#E9DFC8' 'SemiBold'), (Text "  $DOT  $do" 12 '#A99D88')))
  }
  if (-not $data.ok) { return Pill (Text 'Waiting for a save to read' 13 '#E9DFC8' 'SemiBold') }
  if (-not $data.notes) { return $null }
  $steps = @($data.steps)
  if ($steps.Count -eq 0) {
    $say = '  Everything matches the build'
    if ($data.lineupOk) { $say = '  Build and lineup both match' }
    $done = Row-Of @((Text $CHECK 15 '#A9FFE4' 'Bold'), (Text $say 13 '#A9FFE4' 'SemiBold'))
    $why = Stage-Line $data 330
    $four = Lineup-Line $data 330
    if (-not $why -and -not $four) { return Pill $done }
    $both = New-Object Windows.Controls.StackPanel
    [void]$both.Children.Add($done)
    foreach ($line in @($why, $four)) { if ($line) { $line.Margin = '0,4,0,1'; [void]$both.Children.Add($line) } }
    return Pill $both
  }
  $groups = [ordered]@{}
  foreach ($s in $steps) { if (-not $groups.Contains($s.id)) { $groups[$s.id] = @() }; $groups[$s.id] += $s }

  if ($mode -eq 'Mini') {
    $bits = @((Title 'Next Steps'), (Badge ([string]$steps.Count)))
    foreach ($id in $groups.Keys) {
      $who = $groups[$id][0].who
      $bits += (Text "   $who " 13 '#FFF2C9' 'SemiBold')
      $bits += (Text ([string]$groups[$id].Count) 13 '#FFE15A' 'Bold')
    }
    return Pill (Row-Of $bits)
  }

  $root = New-Object Windows.Controls.StackPanel
  $head = New-Object Windows.Controls.DockPanel
  $when = ''
  try { $when = 'saved ' + ([datetime]::Parse($data.saved)).ToLocalTime().ToString('HH:mm') } catch { }
  $right = Text $when 11.5 '#A99D88'
  $right.Margin = '0,4,0,0'
  [Windows.Controls.DockPanel]::SetDock($right, 'Right')
  [void]$head.Children.Add($right)
  [void]$head.Children.Add((Row-Of @((Title 'Next Steps'), (Badge ([string]$steps.Count)))))
  [void]$root.Children.Add($head)
  $rule = New-Object Windows.Shapes.Rectangle
  $rule.Height = 1; $rule.Margin = '0,6,0,2'; $rule.Fill = (Gradient '#D6B160' '#00D6B160' 0)
  [void]$root.Children.Add($rule)
  foreach ($line in @((Stage-Line $data 390), (Lineup-Line $data 390), (Workshop-Line $data 390))) {
    if ($line) { $line.Margin = '0,6,0,0'; [void]$root.Children.Add($line) }
  }

  $shown = 0; $limit = 9
  foreach ($id in $groups.Keys) {
    if ($shown -ge $limit) { break }
    $list = $groups[$id]
    $bar = New-Object Windows.Controls.Border
    $bar.Background = (Gradient '#6A5343' '#3C2B20'); $bar.CornerRadius = 12; $bar.Padding = '6,2,12,2'; $bar.Margin = '0,8,0,3'
    $dock = New-Object Windows.Controls.DockPanel
    $count = Text ([string]$list.Count) 12.5 '#FFF2C9' 'Bold' $fontLabel
    [Windows.Controls.DockPanel]::SetDock($count, 'Right')
    [void]$dock.Children.Add($count)
    [void]$dock.Children.Add((Row-Of @((Face $id $list[0].who $data), (Text $list[0].who 14 '#FFF2C9' 'SemiBold'))))
    $bar.Child = $dock
    [void]$root.Children.Add($bar)

    $first = $true
    foreach ($s in $list) {
      if ($shown -ge $limit) { break }
      $shown++
      $row = New-Object Windows.Controls.Grid
      $row.Margin = '2,4,0,4'
      $c0 = New-Object Windows.Controls.ColumnDefinition; $c0.Width = 84
      $c1 = New-Object Windows.Controls.ColumnDefinition
      [void]$row.ColumnDefinitions.Add($c0); [void]$row.ColumnDefinitions.Add($c1)

      # the slot tag: the page's dark chevron, lightened so it reads on a dark window
      $tag = New-Object Windows.Controls.Grid
      $tag.Width = 74; $tag.Height = 19; $tag.HorizontalAlignment = 'Left'; $tag.VerticalAlignment = 'Top'; $tag.Margin = '0,1,0,0'
      $shape = New-Object Windows.Shapes.Path
      $shape.Data = [Windows.Media.Geometry]::Parse('M6,0 L68,0 74,9.5 68,19 6,19 0,9.5 Z'); $shape.Fill = (Brush '#4DFFFFFF')
      $label = Text ([string]$s.pos).ToUpper() 10.5 '#FFFFFF' 'Normal' $fontLabel
      $label.HorizontalAlignment = 'Center'
      [void]$tag.Children.Add($shape); [void]$tag.Children.Add($label)
      [void]$row.Children.Add($tag)

      $col = New-Object Windows.Controls.StackPanel
      [Windows.Controls.Grid]::SetColumn($col, 1)
      $line = New-Object Windows.Controls.WrapPanel
      if ($s.from -and $s.from -ne 'empty') {
        $from = Text ([string]$s.from) 13 '#A99D88'
        $from.TextDecorations = [Windows.TextDecorations]::Strikethrough
        [void]$line.Children.Add((Row-Of @((Icon $s.fromIcon ([bool]$data.art) 0.6), $from, (Text "  $ARROW  " 13 '#F0566C' 'Bold'))))
      } elseif ($s.from -eq 'empty') {
        [void]$line.Children.Add((Row-Of @((Text 'empty' 13 '#A99D88'), (Text "  $ARROW  " 13 '#F0566C' 'Bold'))))
      }
      [void]$line.Children.Add((Row-Of @((Icon $s.toIcon ([bool]$data.art)), (Text ([string]$s.to) 13.5 '#FFFFFF' 'Bold'))))
      [void]$col.Children.Add($line)
      if ($s.where) { $w = Text ([string]$s.where) 11.5 '#9FD3F0'; $w.Margin = '0,1,0,0'; [void]$col.Children.Add($w) }
      if ($s.gain) { $g = Text ([string]$s.gain) 11.5 '#A9FFE4' 'SemiBold'; $g.Margin = '0,1,0,0'; [void]$col.Children.Add($g) }
      [void]$row.Children.Add($col)

      if (-not $first) {
        $sep = New-Object Windows.Shapes.Rectangle
        $sep.Height = 1; $sep.Fill = (Brush '#24FFFFFF'); $sep.Margin = '2,0,0,0'
        [void]$root.Children.Add($sep)
      }
      $first = $false
      [void]$root.Children.Add($row)
    }
  }

  $notes = @()
  if ($steps.Count -gt $shown) { $notes += ('{0} more' -f ($steps.Count - $shown)) }
  if ($data.optional -gt 0) { $notes += ('{0} optional' -f $data.optional) }
  if ($data.waiting -gt 0) { $notes += ('{0} waiting for materials' -f $data.waiting) }
  $parts = @()
  if ($data.lineupOk) { $parts += 'Lineup OK' }
  if ($notes.Count) { $parts += ('On the page: ' + ($notes -join ', ')) }
  # the long form of the hotkey hint only when there is room for it on one line
  if ($parts.Count -ge 2 -or $notes.Count -ge 3) { $parts += 'Ctrl+Alt+O' } else { $parts += 'Ctrl+Alt+O  list / badge / off' }
  $foot = $parts -join "   $DOT   "
  $f = Text $foot 10.5 '#8F8576'
  $f.Margin = '0,8,0,0'; $f.HorizontalAlignment = 'Right'
  [void]$root.Children.Add($f)
  Frame $root 420
}

function Read-Steps {
  if ($From) { return (Get-Content $From -Raw -Encoding UTF8 | ConvertFrom-Json) }
  $req = [Net.HttpWebRequest]::Create("$base/api/overlay")
  $req.Proxy = $null; $req.Timeout = 700; $req.ReadWriteTimeout = 700
  $res = $req.GetResponse()
  try {
    $reader = New-Object IO.StreamReader $res.GetResponseStream(), ([Text.Encoding]::UTF8)
    $script:lastText = $reader.ReadToEnd()
  } finally { $res.Close() }
  $script:lastText | ConvertFrom-Json
}

# ---- -Snapshot: draw once into a picture, over a stand-in for the game, and leave ---------------
if ($Snapshot) {
  $data = $null
  try { $data = Read-Steps } catch { }
  $view = New-View $data $settings.mode
  $stage = New-Object Windows.Controls.Grid
  $stage.Background = (Gradient '#40584A' '#1D2A33' 60)
  $stage.Width = 560
  if ($view) { $view.LayoutTransform = New-Object Windows.Media.ScaleTransform $Scale, $Scale; $view.Opacity = $Opacity; $view.HorizontalAlignment = 'Right'; $view.VerticalAlignment = 'Top'; [void]$stage.Children.Add($view) }
  else { $stage.Height = 80 }
  $stage.Measure((New-Object Windows.Size 560, 4000))
  $tall = [math]::Max(80, $stage.DesiredSize.Height)
  $stage.Arrange((New-Object Windows.Rect 0, 0, 560, $tall)); $stage.UpdateLayout()
  $bmp = New-Object Windows.Media.Imaging.RenderTargetBitmap ([int](560 * 2)), ([int]($stage.ActualHeight * 2)), 192, 192, ([Windows.Media.PixelFormats]::Pbgra32)
  $bmp.Render($stage)
  $enc = New-Object Windows.Media.Imaging.PngBitmapEncoder
  [void]$enc.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bmp))
  $target = $Snapshot
  if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path (Get-Location) $target }
  $out = [IO.File]::Create($target)
  try { $enc.Save($out) } finally { $out.Close() }
  return
}

# ---- one copy at a time -----------------------------------------------------------------------
$created = $false
$mutex = New-Object Threading.Mutex $true, 'Local\Sky2BuildOverlay', ([ref]$created)
if (-not $created) { return }

# ---- the window -------------------------------------------------------------------------------
$win = New-Object Windows.Window
$win.WindowStyle = 'None'; $win.AllowsTransparency = $true; $win.Background = [Windows.Media.Brushes]::Transparent
$win.Topmost = $true; $win.ShowInTaskbar = $false; $win.ShowActivated = $false; $win.Focusable = $false; $win.IsHitTestVisible = $false
$win.ResizeMode = 'NoResize'; $win.SizeToContent = 'WidthAndHeight'; $win.Title = 'Sky 2nd build overlay'
$win.Left = -10000; $win.Top = -10000
$win.Opacity = $Opacity

$GWL_EXSTYLE = -20
$WS_EX_TRANSPARENT = 0x20; $WS_EX_TOOLWINDOW = 0x80; $WS_EX_LAYERED = 0x80000; $WS_EX_NOACTIVATE = 0x08000000
$win.Add_SourceInitialized({
  $h = (New-Object Windows.Interop.WindowInteropHelper $win).Handle
  $ex = [Sky2.Native]::GetWindowLong($h, $GWL_EXSTYLE)
  # clicks pass through, it never becomes the active window, and it stays out of Alt+Tab
  [void][Sky2.Native]::SetWindowLong($h, $GWL_EXSTYLE, ($ex -bor $WS_EX_TRANSPARENT -bor $WS_EX_TOOLWINDOW -bor $WS_EX_LAYERED -bor $WS_EX_NOACTIVATE))
})

$script:serverOld = $false
$state = @{ data = $null; text = ''; failures = 0; tick = 0; quietSince = $null; shownKey = ''; gameWindow = [IntPtr]::Zero; started = [datetime]::Now }

function Find-Game {
  try {
    $p = Get-Process -Name $Game -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
    if ($p) { $state.gameWindow = $p.MainWindowHandle } else { $state.gameWindow = [IntPtr]::Zero }
  } catch { $state.gameWindow = [IntPtr]::Zero }
}

function Update-View {
  $key = $settings.mode + '|' + [bool]$state.failures + '|' + $script:serverOld + '|' + $state.text
  if ($key -eq $state.shownKey) { return }
  $state.shownKey = $key
  $data = $state.data
  if ($state.failures -gt 0) { $data = $null }
  $view = New-View $data $settings.mode
  if ($view) { $view.LayoutTransform = New-Object Windows.Media.ScaleTransform $Scale, $Scale }
  $win.Content = $view
  # "nothing to do" and "server not running" say their piece and then get out of the way
  $steady = ($view -ne $null) -and ($state.failures -eq 0) -and $data -and $data.ok -and (@($data.steps).Count -gt 0)
  if ($steady) { $state.quietSince = $null } else { $state.quietSince = [datetime]::Now }
}

function Place-Window {
  $want = $win.Content -ne $null
  if ($want -and $state.quietSince -and ([datetime]::Now - $state.quietSince).TotalSeconds -gt 8) { $want = $false }
  $game = $state.gameWindow
  $rect = $null
  if ($game -ne [IntPtr]::Zero -and -not [Sky2.Native]::IsIconic($game)) {
    $r = New-Object Sky2.Native+RECT; $p = New-Object Sky2.Native+POINT
    if ([Sky2.Native]::GetClientRect($game, [ref]$r) -and [Sky2.Native]::ClientToScreen($game, [ref]$p) -and $r.Right -gt 200) {
      $rect = @{ L = $p.X; T = $p.Y; R = $p.X + $r.Right; B = $p.Y + $r.Bottom }
    }
  }
  $front = ($game -ne [IntPtr]::Zero) -and ([Sky2.Native]::GetForegroundWindow() -eq $game)
  if (-not $Always -and -not $front) { $want = $false }
  if (-not $rect) {
    if (-not $Always) { $want = $false }
    $wa = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $rect = @{ L = $wa.Left; T = $wa.Top; R = $wa.Right; B = $wa.Bottom }
  }
  if (-not $want) { if ($win.IsVisible) { $win.Hide() }; return }
  if (-not $win.IsVisible) { $win.Show() }
  $win.UpdateLayout()
  # the game's rectangle is in pixels, the window's position in WPF units
  $src = [Windows.PresentationSource]::FromVisual($win)
  $k = 1.0
  if ($src -and $src.CompositionTarget) { $k = $src.CompositionTarget.TransformToDevice.M11 }
  $w = $win.ActualWidth; $h = $win.ActualHeight; $pad = 6
  if ($settings.corner -like '*Right') { $win.Left = $rect.R / $k - $w - $pad } else { $win.Left = $rect.L / $k + $pad }
  if ($settings.corner -like 'Bottom*') { $win.Top = $rect.B / $k - $h - $pad } else { $win.Top = $rect.T / $k + $pad }
  # games like to put themselves back on top: ask again, without taking focus
  $hwnd = (New-Object Windows.Interop.WindowInteropHelper $win).Handle
  [void][Sky2.Native]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x0013)
}

function Set-Mode([string]$m) { $settings.mode = $m; Save-Settings; Update-View; Place-Window; Sync-Menu }
function Next-Mode { $order = @('Full', 'Mini', 'Off'); Set-Mode $order[([array]::IndexOf($order, $settings.mode) + 1) % 3] }

# ---- tray icon: the only thing you can click, since the overlay itself lets clicks through ----
$bitmap = New-Object Drawing.Bitmap 32, 32
$gfx = [Drawing.Graphics]::FromImage($bitmap)
$gfx.SmoothingMode = 'AntiAlias'
$gfx.FillEllipse((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(214, 177, 96))), 1, 1, 30, 30)
$gfx.FillEllipse((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(156, 27, 27))), 7, 7, 18, 18)
$gfx.FillEllipse((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 243, 207))), 13, 13, 6, 6)
$gfx.Dispose()
$hicon = $bitmap.GetHicon()
$tray = New-Object Windows.Forms.NotifyIcon
$tray.Icon = [Drawing.Icon]::FromHandle($hicon); $tray.Text = 'Sky 2nd build overlay'; $tray.Visible = $true
$menu = New-Object Windows.Forms.ContextMenuStrip
$items = @{}
function Add-Item([string]$key, [string]$label, [scriptblock]$action, $parent = $menu) {
  $i = New-Object Windows.Forms.ToolStripMenuItem $label
  $i.Add_Click($action)
  if ($parent -is [Windows.Forms.ToolStripMenuItem]) { [void]$parent.DropDownItems.Add($i) } else { [void]$parent.Items.Add($i) }
  $items[$key] = $i
  $i
}
[void](Add-Item 'Full' 'Show the list' { Set-Mode 'Full' })
[void](Add-Item 'Mini' 'Show a small badge' { Set-Mode 'Mini' })
[void](Add-Item 'Off' 'Hide' { Set-Mode 'Off' })
[void]$menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
$cornerMenu = New-Object Windows.Forms.ToolStripMenuItem 'Corner'
[void]$menu.Items.Add($cornerMenu)
foreach ($c in @(@('TopRight', 'Top right'), @('TopLeft', 'Top left'), @('BottomRight', 'Bottom right'), @('BottomLeft', 'Bottom left'))) {
  $name = $c[0]
  [void](Add-Item $name $c[1] ([scriptblock]::Create("`$settings.corner = '$name'; Save-Settings; Place-Window; Sync-Menu")) $cornerMenu)
}
[void](Add-Item 'Always' 'Show when the game is not in front' { $script:Always = -not $Always; Place-Window; Sync-Menu })
[void]$menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
[void](Add-Item 'Exit' 'Exit' { $app.Shutdown() })
function Sync-Menu {
  foreach ($m in 'Full', 'Mini', 'Off') { $items[$m].Checked = ($settings.mode -eq $m) }
  foreach ($c in 'TopRight', 'TopLeft', 'BottomRight', 'BottomLeft') { $items[$c].Checked = ($settings.corner -eq $c) }
  $items['Always'].Checked = [bool]$Always
}
Sync-Menu
$tray.ContextMenuStrip = $menu
$tray.Add_MouseClick({
  param($s, $e)
  if ($e.Button -eq 'Left') { Next-Mode }
})

# ---- Ctrl+Alt+O: a hidden message window receives it, so the overlay never needs the keyboard ----
$hotkeys = $null
try {
  $keyWindow = New-Object Windows.Interop.HwndSourceParameters 'sky2-overlay-keys'
  $keyWindow.WindowStyle = 0; $keyWindow.Width = 0; $keyWindow.Height = 0
  $keyWindow.ParentWindow = [IntPtr](-3)   # message-only: it has no place on screen at all
  $hotkeys = New-Object Windows.Interop.HwndSource $keyWindow
  $hotkeys.AddHook([Windows.Interop.HwndSourceHook] {
    param($hwnd, $msg, $wParam, $lParam, [ref]$handled)
    if ($msg -eq 0x0312) { Next-Mode; $handled.Value = $true }
    [IntPtr]::Zero
  })
  # 0x4001 | 0x0002 = Alt + Ctrl, without auto-repeat; 0x4F = O
  $hotkeyOn = [Sky2.Native]::RegisterHotKey($hotkeys.Handle, 1, 0x4003, 0x4F)
} catch { $hotkeyOn = $false }

# ---- the loop: where the game is twice a second, the steps every two seconds --------------------
$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(500)
$timer.Add_Tick({
  try {
    $n = $state.tick++
    if ($n % 6 -eq 0) { Find-Game }
    $every = 4
    if ($state.failures -gt 0) { $every = 20 }   # the server is not there: ask less often
    if ($n % $every -eq 0) {
      try {
        $state.data = Read-Steps
        $state.text = $script:lastText
        $state.failures = 0
      } catch {
        $state.failures++
        # a server that answers but does not know the overlay is one started before this was added
        $web = $_.Exception.GetBaseException() -as [Net.WebException]
        $script:serverOld = [bool]($web -and $web.Response -and [int]$web.Response.StatusCode -eq 404)
      }
      Update-View
    }
    Place-Window
  } catch {
    Add-Content (Join-Path $env:TEMP 'sky2-build-overlay.log') ((Get-Date).ToString('s') + '  ' + $_.Exception.Message)
  }
})

# -ExitAfter / -Proof: a short run that records what happened, for checking a new setup
function Save-Proof {
  if (-not $Proof) { return }
  $hwnd = (New-Object Windows.Interop.WindowInteropHelper $win).Handle
  $src = [Windows.PresentationSource]::FromVisual($win)
  $k = 1.0
  if ($src -and $src.CompositionTarget) { $k = $src.CompositionTarget.TransformToDevice.M11 }
  $facts = @(
    'visible: ' + $win.IsVisible,
    'position: ' + [int]($win.Left * $k) + ',' + [int]($win.Top * $k) + '  size: ' + [int]($win.ActualWidth * $k) + 'x' + [int]($win.ActualHeight * $k),
    'game window found: ' + ($state.gameWindow -ne [IntPtr]::Zero),
    'game still in front: ' + ([Sky2.Native]::GetForegroundWindow() -eq $state.gameWindow),
    'overlay in front: ' + ([Sky2.Native]::GetForegroundWindow() -eq $hwnd),
    ('extended style: 0x{0:x8}' -f [Sky2.Native]::GetWindowLong($hwnd, $GWL_EXSTYLE)),
    'hotkey registered: ' + $hotkeyOn,
    'server answered: ' + ($state.failures -eq 0),
    'steps: ' + $(if ($state.data -and $state.data.steps) { @($state.data.steps).Count } else { 0 })
  )
  $target = $Proof
  if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path (Get-Location) $target }
  Set-Content ([IO.Path]::ChangeExtension($target, '.txt')) $facts
  if ($win.IsVisible -and $win.ActualWidth -gt 0) {
    $w = [int]($win.ActualWidth * $k); $h = [int]($win.ActualHeight * $k)
    $shot = New-Object Drawing.Bitmap $w, $h
    $g = [Drawing.Graphics]::FromImage($shot)
    $g.CopyFromScreen([int]($win.Left * $k), [int]($win.Top * $k), 0, 0, (New-Object Drawing.Size $w, $h))
    $g.Dispose(); $shot.Save($target, [Drawing.Imaging.ImageFormat]::Png); $shot.Dispose()
  }
}

$app = New-Object Windows.Application
$app.ShutdownMode = 'OnExplicitShutdown'
$app.Add_Startup({
  $timer.Start()
  if ($ExitAfter -gt 0) {
    $script:stop = New-Object Windows.Threading.DispatcherTimer   # script scope: it has to outlive this handler
    $script:stop.Interval = [TimeSpan]::FromSeconds($ExitAfter)
    $script:stop.Add_Tick({ $script:stop.Stop(); try { Save-Proof } catch { Add-Content (Join-Path $env:TEMP 'sky2-build-overlay.log') $_.Exception.Message }; $app.Shutdown() })
    $script:stop.Start()
    return
  }
  $hint = 'Shows your next steps over the game.'
  if ($hotkeyOn) { $hint += ' Ctrl+Alt+O switches list, badge and off.' } else { $hint += ' Click this icon to switch list, badge and off.' }
  $tray.ShowBalloonTip(4000, 'Sky 2nd build overlay', $hint, 'None')
})
try { [void]$app.Run() }
finally {
  $timer.Stop()
  if ($hotkeys) { [void][Sky2.Native]::UnregisterHotKey($hotkeys.Handle, 1); $hotkeys.Dispose() }
  $tray.Visible = $false; $tray.Dispose()
  [void][Sky2.Native]::DestroyIcon($hicon)
  $mutex.ReleaseMutex()
}
