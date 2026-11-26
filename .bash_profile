# Bun and Codex command paths
export BUN_INSTALL="/home/mis/.bun"
export PATH="/home/mis/.bun/bin:/home/mis/.local/bin:$PATH"

#
# ~/.bash_profile
#

[[ -f ~/.bashrc ]] && . ~/.bashrc
. "$HOME/.cargo/env"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"


# Added by Antigravity CLI installer
export PATH="/home/mis/.local/bin:$PATH"
