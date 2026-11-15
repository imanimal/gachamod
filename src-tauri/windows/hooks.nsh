; gachamod's additions to the installer (tauri.conf.json: bundle > windows > nsis > installerHooks).

; Zenless Zone Zero and some other games run as administrator, and Windows keeps keys from a program that doesn't
; away from them. The player chooses whether gachamod starts as administrator: asked once, on a fresh install with the
; full installer, No by default. HKCU\Software\gachamod keeps the answer (`admin`, which Settings also writes), so an
; upgrade that uninstalls the old version first puts it back without asking. Updates and quiet installs don't ask.
!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  ReadRegStr $R0 HKCU "Software\gachamod" "adminAsked"
  ${If} $R0 != "1"
  ${AndIfNot} ${Silent}
  ${AndIf} $PassiveMode != 1
  ${AndIf} $UpdateMode != 1
    WriteRegStr HKCU "Software\gachamod" "adminAsked" "1"
    WriteRegStr HKCU "Software\gachamod" "admin" "0"
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Run gachamod as administrator?$\r$\n$\r$\nZenless Zone Zero and some other games run as administrator. gachamod can only send them keys (switching skins without pressing F10) when it runs as administrator too. Windows asks for permission each time gachamod starts.$\r$\n$\r$\nYou can change this later in Settings." /SD IDNO IDNO gachamod_admin_no
      WriteRegStr HKCU "Software\gachamod" "admin" "1"
    gachamod_admin_no:
  ${EndIf}
  ; Windows' "Run this program as an administrator" for gachamod.exe, unless the exe already has its own flags
  ReadRegStr $R0 HKCU "Software\gachamod" "admin"
  ${If} $R0 == "1"
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\${MAINBINARYNAME}.exe"
    ${If} $R0 == ""
      WriteRegStr HKCU "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\${MAINBINARYNAME}.exe" "~ RUNASADMIN"
    ${EndIf}
  ${EndIf}
  Pop $R0
!macroend

; The exe is gone, so its flag goes too (a reinstall puts it back from `admin`). The answer itself stays unless the
; player ticked "Delete the application data".
!macro NSIS_HOOK_POSTUNINSTALL
  Push $R0
  DeleteRegValue HKCU "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\${MAINBINARYNAME}.exe"
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    DeleteRegKey HKCU "Software\gachamod"
  ${EndIf}
  ; The gachamod: link handler and .gachamod files gachamod registers itself at start (platform.rs), while they still
  ; open this copy. Another copy's, or another program's, stay. An upgrade's next start registers them again.
  ${If} $UpdateMode <> 1
    ReadRegStr $R0 HKCU "Software\Classes\gachamod\shell\open\command" ""
    ${If} $R0 == '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
      DeleteRegKey HKCU "Software\Classes\gachamod"
    ${EndIf}
    ReadRegStr $R0 HKCU "Software\Classes\gachamod.pack\shell\open\command" ""
    ${If} $R0 == '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
      DeleteRegKey HKCU "Software\Classes\gachamod.pack"
      ReadRegStr $R0 HKCU "Software\Classes\.gachamod" ""
      ${If} $R0 == "gachamod.pack"
        DeleteRegKey HKCU "Software\Classes\.gachamod"
      ${EndIf}
    ${EndIf}
    ; SHCNE_ASSOCCHANGED: Explorer drops the old file icon
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
  Pop $R0
!macroend
