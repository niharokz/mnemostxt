; Windows installer hooks (NSIS), included by Tauri's installer script.
; Adds "Open with MnemoTXT" to the right-click menu of every file and folder,
; like VS Code does. Per-user install, so everything goes under HKCU.

!macro NSIS_HOOK_POSTINSTALL
  ; the name people see is MnemoTXT; the package and the .exe stay "mnemostxt"
  ; so updates install over the old version (Tauri names both after productName)
  IfFileExists "$SMPROGRAMS\${PRODUCTNAME}.lnk" 0 +2
    Rename "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$SMPROGRAMS\MnemoTXT.lnk"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" "DisplayName" "MnemoTXT"
  WriteRegStr HKCU "Software\Classes\*\shell\mnemostxt" "" "Open with MnemoTXT"
  WriteRegStr HKCU "Software\Classes\*\shell\mnemostxt" "Icon" "$INSTDIR\mnemostxt.exe"
  WriteRegStr HKCU "Software\Classes\*\shell\mnemostxt\command" "" '"$INSTDIR\mnemostxt.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\mnemostxt" "" "Open folder in MnemoTXT"
  WriteRegStr HKCU "Software\Classes\Directory\shell\mnemostxt" "Icon" "$INSTDIR\mnemostxt.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\mnemostxt\command" "" '"$INSTDIR\mnemostxt.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\*\shell\mnemostxt"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\mnemostxt"
!macroend
