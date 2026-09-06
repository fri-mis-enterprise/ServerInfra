# Lines configured by zsh-newuser-install
HISTFILE=~/.histfile
HISTSIZE=1000
SAVEHIST=1000
setopt autocd beep extendedglob nomatch notify
bindkey -v
# End of lines configured by zsh-newuser-install
# The following lines were added by compinstall
zstyle :compinstall filename '/home/mis/.zshrc'

autoload -Uz compinit
compinit
# End of lines added by compinstall

PROMPT='%F{cyan}%~%f ❯ '

if command -v tmux >/dev/null 2>&1 && [[ -z "$TMUX" ]] && [[ -n "$SSH_CONNECTION" ]]; then
    tmux attach-session -t main 2>/dev/null || tmux new-session -s SSH
fi
