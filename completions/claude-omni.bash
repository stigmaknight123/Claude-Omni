# bash completion for claude-omni
_claude_omni() {
  local cur prev
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  case "$prev" in
    -m)
      COMPREPLY=( $(compgen -W "$(claude-omni --list 2>/dev/null | tr -d ' ' | tr '\n' ' ')" -- "$cur") )
      return ;;
  esac

  COMPREPLY=( $(compgen -W "--go --zen --openrouter --status --list --update --version -m -- -h --help" -- "$cur") )
}
complete -F _claude_omni claude-omni
