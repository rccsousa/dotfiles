# dotfiles

Bare git repo (`~/.dotfiles`) with `$HOME` as work tree. Files live at their real paths; no installer.

## New machine

```sh
git clone --bare <remote> ~/.dotfiles
git --git-dir=$HOME/.dotfiles --work-tree=$HOME checkout   # move aside any clashing files it lists
git --git-dir=$HOME/.dotfiles --work-tree=$HOME config status.showUntrackedFiles no
```

After that the `dot` alias (in `~/.config/zsh/aliases.zsh`) replaces the long git command: `dot status`, `dot add`, `dot commit`, `dot push`.

## Machine-specific and secrets

Untracked, create per machine: `~/.zshrc.local` (see `~/.config/zsh/zshrc.local.example`) and `~/.gitconfig.local` (credential helper, extra excludes).

## Agent hooks and statusline

`~/.claude/hooks/` and `~/.codex/hooks/` hold the secret-file and recursive-grep guards; `~/.claude/statusline-command.sh` is the Claude statusline (needs `jq`). `~/.claude/settings.json` and `~/.codex/hooks.json` register them, and `~/.claude/ripgreprc` / `~/.codex/ripgreprc` keep secrets out of `rg` searches.

`~/.codex/config.toml` is untracked because the Codex app rewrites it. On a new machine add the ripgrep config and approve the hooks when Codex asks:

```toml
[shell_environment_policy.set]
RIPGREP_CONFIG_PATH = "/Users/ruisousa/.codex/ripgreprc"
```

`~/.claude/tools/br/` is the CDP browser CLI behind the `browser` skill; `~/.local/bin/br` runs it with `bun`.

## Tools

`~/.config/dotfiles/Brewfile`: `brew bundle --file=~/.config/dotfiles/Brewfile`. Neovim needs 0.11+, `ripgrep`, `make`, and `xclip` or `wl-clipboard` on Linux.
