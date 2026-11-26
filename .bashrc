# Bun and Codex command paths
export BUN_INSTALL="/home/mis/.bun"
export PATH="/home/mis/.bun/bin:/home/mis/.local/bin:$PATH"

#
# ~/.bashrc
#

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

alias ls='ls --color=auto'
alias grep='grep --color=auto'
PS1='[\u@\h \W]\$ '

if [[ -z "$ZSH_VERSION" ]] && command -v zsh >/dev/null 2>&1; then
	exec zsh
fi
. "$HOME/.cargo/env"

# >>> Codex installer >>>
export PATH="/home/mis/.local/bin:$PATH"
# <<< Codex installer <<<
