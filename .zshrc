export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git)
[[ -r "$ZSH/oh-my-zsh.sh" ]] && source "$ZSH/oh-my-zsh.sh"

export EDITOR="nvim"

for config in path aliases functions; do
  source "$HOME/.config/zsh/$config.zsh"
done

# Machine-specific config and secrets; never committed.
[[ -r "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"
