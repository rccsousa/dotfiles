path_prepend() { [[ -d "$1" ]] && path=("$1" ${path:#$1}) }

path_prepend "$HOME/.asdf/shims"
path_prepend "$HOME/.local/bin"
path_prepend "/opt/homebrew/sbin"
path_prepend "/opt/homebrew/bin"

typeset -U path
