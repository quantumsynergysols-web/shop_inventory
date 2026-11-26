# English narration for the how-to video, with a voice built into Windows (offline, no cost):
#   powershell -ExecutionPolicy Bypass -File scripts/make-voice-en.ps1
# Reads docs/demo/voice-howto-en/lines.txt (one line per caption step of scripts/record-howto.mjs)
# and writes step-NN.mp3 next to it (ffmpeg converts the WAV).
param([string]$Voice = 'Microsoft David Desktop', [int]$Rate = 0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$dir = Join-Path $PSScriptRoot '..\docs\demo\voice-howto-en'
$lines = Get-Content (Join-Path $dir 'lines.txt') -Encoding UTF8 | Where-Object { $_.Trim() }
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($Voice)
$s.Rate = $Rate
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 22050, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
for ($i = 0; $i -lt $lines.Count; $i++) {
  $n = '{0:D2}' -f ($i + 1)
  $wav = Join-Path $env:TEMP "howto-en-$n.wav"
  $s.SetOutputToWaveFile($wav, $fmt)
  $s.Speak($lines[$i])
  $s.SetOutputToNull()
  & ffmpeg -y -loglevel error -i $wav -af 'highpass=f=70,afade=t=in:d=0.02' -c:a libmp3lame -b:a 128k (Join-Path $dir "step-$n.mp3")
  Remove-Item $wav
  "step-$n"
}
$s.Dispose()
