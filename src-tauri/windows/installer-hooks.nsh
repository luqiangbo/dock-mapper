!include "FileFunc.nsh"

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $R0 0
  StrCpy $R1 0
  StrCpy $R2 0
  StrCpy $R3 0
  SetRegView 64
  ReadRegDWord $R0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ReadRegDWord $R1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Major"
  ReadRegDWord $R2 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Minor"
  ReadRegDWord $R3 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Bld"
  SetRegView 32

  ${If} $R0 == 1
    ${If} $R1 > 14
      Goto dockmapper_vcredist_ready
    ${ElseIf} $R1 == 14
      ${If} $R2 > 51
        Goto dockmapper_vcredist_ready
      ${ElseIf} $R2 == 51
        ${If} $R3 >= 36247
          Goto dockmapper_vcredist_ready
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ${IfNot} ${FileExists} "$INSTDIR\resources\runtime\vc_redist.x64.exe"
    MessageBox MB_ICONSTOP "DockMapper 缺少 Microsoft Visual C++ 运行库安装文件，安装无法继续。"
    Abort
  ${EndIf}

  DetailPrint "Installing Microsoft Visual C++ x64 runtime"
  ExecWait '"$INSTDIR\resources\runtime\vc_redist.x64.exe" /install /quiet /norestart' $R0
  ${If} $R0 == 0
    DetailPrint "Microsoft Visual C++ x64 runtime installed successfully"
  ${ElseIf} $R0 == 3010
    DetailPrint "Microsoft Visual C++ x64 runtime installed; restart required"
  ${Else}
    MessageBox MB_ICONSTOP "Microsoft Visual C++ 运行库安装失败（退出码：$R0），DockMapper 可能无法启动。"
    Abort
  ${EndIf}
  Goto dockmapper_vcredist_cleanup

dockmapper_vcredist_ready:
  DetailPrint "Microsoft Visual C++ x64 runtime 14.51.36247 or newer is already installed"
dockmapper_vcredist_cleanup:
  Delete "$INSTDIR\resources\runtime\vc_redist.x64.exe"
  Delete "$INSTDIR\resources\runtime\README.txt"
  RMDir "$INSTDIR\resources\runtime"
  ; A fresh identity for every install, even a reinstall of the same build.
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  System::Call 'kernel32::GetTickCount64() l .r7'
  ClearErrors
  FileOpen $8 "$INSTDIR\settings-reset.token" w
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "无法写入设置重置标记，安装未完成。"
    Abort
  ${EndIf}
  FileWrite $8 "$2-$1-$0T$4:$5:$6-$7"
  FileClose $8
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "设置重置标记写入失败，安装未完成。"
    Abort
  ${EndIf}
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
