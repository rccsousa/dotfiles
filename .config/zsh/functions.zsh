e() {
  if [[ "$1" == "d" ]]; then
    exercism download --track "$2" --exercise "$3"
  else
    echo "Usage: e d <track> <exercise>"
  fi
}

convert_video() {
  local location="${2:-$PWD}"
  cat "$location"/*.VOB > "$location/COMBINED.VOB"
  ffmpeg -i "$location/COMBINED.VOB" "$1.mp4"
  rm "$location/COMBINED.VOB"
}

nix-install() {
  nix-env -iA "nixpkgs.$1"
}
