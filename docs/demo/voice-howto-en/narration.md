# How-to video narration (English)

Voice: "Microsoft David Desktop", built into Windows (offline, no cost), made 26 Nov 2026 with
`scripts/make-voice-en.ps1` from `lines.txt` (one line per caption step of `scripts/record-howto.mjs`).
The ElevenLabs voices used for the Urdu video need a FameSpeak plan with API access; to swap in a
more natural voice later, replace `step-NN.mp3` and run `node scripts/record-howto.mjs --en` again.
To change a line: edit `lines.txt`, run the PowerShell script, then record again.
