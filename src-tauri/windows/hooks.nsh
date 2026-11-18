; gachamod's additions to the installer (tauri.conf.json: bundle > windows > nsis > installerHooks).

; gachamod setup (src-setup) does repair and uninstall in the app's theme. scripts/build-installer.mjs puts it here
; while the installer builds; a plain `tauri build` leaves it out and keeps NSIS's own uninstall entry. Defined at the
; top: inside a macro, __FILEDIR__ is the folder of the generated installer.nsi.
!define GACHAMOD_SETUP_EXE "${__FILEDIR__}\..\..\target\gachamod-setup\setup.exe"
; The quickstart shortcut's icon (gacha-core shortcuts.rs writes the same file when it's missing).
!define GACHAMOD_QUICKSTART_ICO "${__FILEDIR__}\..\icons\quickstart.ico"

; Zenless Zone Zero and some other games run as administrator, and Windows keeps keys from a program that doesn't
; away from them. The player chooses whether gachamod starts as administrator: asked once, on a fresh install with the
; full installer, Yes by default. HKCU\Software\gachamod keeps the answer (`admin`, which Settings also writes), so an
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
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Run gachamod as administrator?$\r$\n$\r$\nZenless Zone Zero and some other games run as administrator. gachamod can only send them keys (switching skins without pressing F10) when it runs as administrator too. Windows asks for permission each time gachamod starts.$\r$\n$\r$\nYou can change this later in Settings." /SD IDNO IDNO gachamod_admin_no
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

  ; gachamod setup next to gachamod, and Windows' uninstall entry pointed at it
  !if /FileExists "${GACHAMOD_SETUP_EXE}"
    SetOverwrite try
    File "/oname=setup.exe" "${GACHAMOD_SETUP_EXE}"
    SetOverwrite on
  !endif
  ${If} ${FileExists} "$INSTDIR\setup.exe"
    WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" '"$INSTDIR\setup.exe" --uninstall'
    WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
    WriteRegStr SHCTX "${UNINSTKEY}" "ModifyPath" '"$INSTDIR\setup.exe"'
    WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" 0
  ${EndIf}

  ; A quiet install makes a desktop shortcut. gachamod setup has a box for it and keeps the answer in
  ; `desktopShortcut`, so a repair leaves the desktop as the player set it.
  ${If} ${Silent}
  ${AndIf} $UpdateMode <> 1
    ReadRegStr $R0 HKCU "Software\gachamod" "desktopShortcut"
    ${If} $R0 == "0"
      !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $R0
      ${If} $R0 = 1
        Delete "$DESKTOP\${PRODUCTNAME}.lnk"
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ; The quickstart shortcut starts the game gachamod last had open, with mods (gachamod://play). gachamod setup asks
  ; for it and keeps the answer in `quickstartShortcut`, which Settings also writes. Updates leave the desktop alone.
  SetOverwrite try
  File "/oname=quickstart.ico" "${GACHAMOD_QUICKSTART_ICO}"
  SetOverwrite on
  ${If} $UpdateMode <> 1
    ReadRegStr $R0 HKCU "Software\gachamod" "quickstartShortcut"
    ${If} $R0 == "1"
      CreateShortCut "$DESKTOP\${PRODUCTNAME} quickstart.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "gachamod://play" "$INSTDIR\quickstart.ico" 0 SW_SHOWNORMAL "" "Starts the game gachamod last had open, with mods"
    ${ElseIf} $R0 == "0"
      !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME} quickstart.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $R0
      ${If} $R0 = 1
        Delete "$DESKTOP\${PRODUCTNAME} quickstart.lnk"
      ${EndIf}
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
    ; the quickstart shortcut, when it opens this copy, and its icon
    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME} quickstart.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $R0
    ${If} $R0 = 1
      Delete "$DESKTOP\${PRODUCTNAME} quickstart.lnk"
    ${EndIf}
    ; quickstarts for one game ("Zenless Zone Zero quickstart.lnk", gacha-core shortcuts.rs), when they open this copy
    Push $R1
    Push $R2
    FindFirst $R1 $R2 "$DESKTOP\* quickstart.lnk"
    ${DoWhile} $R2 != ""
      !insertmacro IsShortcutTarget "$DESKTOP\$R2" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $R0
      ${If} $R0 = 1
        Delete "$DESKTOP\$R2"
      ${EndIf}
      FindNext $R1 $R2
    ${Loop}
    FindClose $R1
    Pop $R2
    Pop $R1
    Delete "$INSTDIR\quickstart.ico"
    ; gachamod setup, when this uninstaller ran on its own (setup runs from a copy in %TEMP%)
    Delete "$INSTDIR\setup.exe"
    RMDir "$INSTDIR"
  ${EndIf}
  Pop $R0
!macroend
