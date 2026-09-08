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
    if tmux has-session -t SSH 2>/dev/null; then
        tmux attach-session -t SSH
    else
        tmux new-session -s SSH
    fi
fi

# Trash for safely deleting files using 'rm' command
alias rm='trash-put'

eval "$(zoxide init zsh --cmd cd)"
