; Tauri NSIS Installer Hooks
; Injected via bundle.windows.nsis.installerHooks in tauri.conf.json
;
; Supported hooks:
;   NSIS_HOOK_PREINSTALL  - runs before copying files
;   NSIS_HOOK_POSTINSTALL - runs after copying files
;   NSIS_HOOK_PREUNINSTALL  - runs before removing files
;   NSIS_HOOK_POSTUNINSTALL - runs after removing files

!macro NSIS_HOOK_PREUNINSTALL
  ; Ask the user whether to delete configuration data during uninstallation
  ; Default is IDNO (keep configuration) to prevent accidental data loss
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "$(^Name) 即将被卸载。$\n$\n是否同时删除应用配置数据？$\n$\n配置目录：$\n  • $PROFILE\.claude\$\n  • $APPDATA\Claude Code Desktop\$\n$\n选择「否」将保留配置数据，以便后续重新安装时使用。" \
    /SD IDNO \
    IDYES delete_config IDNO skip_config

  delete_config:
    ; Delete Claude Code core configuration directory (~/.claude/)
    RMDir /r "$PROFILE\.claude"
    ; Delete Tauri app data directory (%APPDATA%\Claude Code Desktop\)
    RMDir /r "$APPDATA\Claude Code Desktop"
    Goto config_done

  skip_config:
    ; User chose to keep configuration directories — do nothing

  config_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Nothing additional needed after uninstall
!macroend
