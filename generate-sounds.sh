#!/bin/bash
# Generates TTS placeholder WAV files into sounds/tts/.
# Uses macOS say + afconvert (no dependencies needed).
# Run from project root: bash generate-sounds.sh
# Replace individual files later with ElevenLabs or real recordings.

VOICE="Daniel"  # British English — sounds more announcer-like
RATE=160
OUT="./sounds/tts"

mkdir -p "$OUT"

speak() {
  local file="$1"
  local text="$2"
  say -v "$VOICE" -r "$RATE" "$text" -o /tmp/_say_tmp.aiff
  afconvert -f WAVE -d LEI16 /tmp/_say_tmp.aiff "$OUT/$file"
  echo "  $file  ←  \"$text\""
}

echo "Generating score sounds 1–60 in $OUT/ ..."

# English number words for 1–60
WORDS=(
  ''           # 0 (unused)
  'one'        'two'          'three'        'four'         'five'
  'six'        'seven'        'eight'        'nine'         'ten'
  'eleven'     'twelve'       'thirteen'     'fourteen'     'fifteen'
  'sixteen'    'seventeen'    'eighteen'     'nineteen'     'twenty'
  'twenty one' 'twenty two'   'twenty three' 'twenty four'  'twenty five'
  'twenty six' 'twenty seven' 'twenty eight' 'twenty nine'  'thirty'
  'thirty one' 'thirty two'   'thirty three' 'thirty four'  'thirty five'
  'thirty six' 'thirty seven' 'thirty eight' 'thirty nine'  'forty'
  'forty one'  'forty two'    'forty three'  'forty four'   'forty five'
  'forty six'  'forty seven'  'forty eight'  'forty nine'   'fifty'
  'fifty one'  'fifty two'    'fifty three'  'fifty four'   'fifty five'
  'fifty six'  'fifty seven'  'fifty eight'  'fifty nine'   'sixty'
)

for i in $(seq 1 60); do
  speak "$i.wav" "${WORDS[$i]}"
done

echo ""
echo "Generating named event sounds ..."

# Game events
speak "missed.wav"      "Missed"
speak "bullseye.wav"    "Bullseye"
speak "twenty_five.wav" "Twenty five"
speak "bust.wav"        "Bust"
speak "takeout.wav"     "Takeout"
speak "leg_won.wav"     "Leg won"
speak "set_won.wav"     "Set won"

# Special events
speak "one_twenty.wav"             "One twenty"
speak "one_two_three.wav"          "One, two, three"
speak "three_ones.wav"             "Three ones"
speak "three_sixes.wav"            "Three sixes"
speak "double_oh_seven.wav"        "Double oh seven"
speak "four_twenty.wav"            "Four twenty"
speak "thirteen_thirty_seven.wav"  "Thirteen thirty seven"
speak "triple_seven.wav"           "Seven, seven, seven"
speak "sixty_nine.wav"             "Sixty nine"
speak "one_one_two.wav"            "One one two"
speak "nine_one_one.wav"           "Nine one one"
speak "six_seven.wav"              "Six seven"
speak "nineteen_oh_four.wav"       "Nineteen oh four"
speak "eighteen_eighty_eight.wav"  "Eighteen eighty eight"
speak "ninety_nine.wav"            "Ninety nine"
speak "twenty_one.wav"             "Twenty one"
speak "twenty_three.wav"           "Twenty three"
speak "four_oh_four.wav"           "Four oh four"
speak "three_misses.wav"           "Three misses. Unlucky"

echo ""
COUNT=$(ls "$OUT"/*.wav 2>/dev/null | wc -l | tr -d ' ')
echo "Done. $COUNT files in $OUT/"
echo ""
echo "To override a score, add to config.json sounds:"
echo '  "score_60": { "files": ["tts/60.wav", "your_custom.wav"] }'
