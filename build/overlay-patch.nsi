Unicode true
RequestExecutionLevel admin
ManifestDPIAware true

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define APP_EXE "开源餐饮库存审查版.exe"
!define APP_DIR "开源餐饮库存审查版"
!ifndef PATCH_VERSION
  !define PATCH_VERSION "0.1.13"
!endif
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\030dccd6-8e98-59df-bcb7-e68887a68c53"

Var DetectedInstallDir

Name "门店进销存系统 ${PATCH_VERSION} 覆盖补丁"
OutFile "${PATCH_OUT_FILE}"

!ifdef TEST_INSTALL_DIR
  InstallDir "${TEST_INSTALL_DIR}"
!else
  InstallDir "$LOCALAPPDATA\Programs\${APP_DIR}"
!endif

ShowInstDetails show
SetOverwrite on
; payload.7z 已经压缩，安装器不再二次压缩，减少制作和解包时间。
SetCompress off

!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "更新完成后打开门店进销存系统"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

!macro TryExistingInstall ROOT VIEW
  SetRegView ${VIEW}
  ReadRegStr $0 ${ROOT} "${UNINSTALL_KEY}" "DisplayIcon"
  ${If} $0 != ""
    ; electron-builder 的 DisplayIcon 通常是“完整exe路径,0”。去掉图标序号后取父目录。
    StrCpy $1 $0
    StrCpy $2 $1 1 -2
    ${If} $2 == ","
      StrCpy $1 $1 -2
    ${EndIf}
    ${GetParent} $1 $2
    ${If} ${FileExists} "$2\${APP_EXE}"
      StrCpy $DetectedInstallDir $2
      Return
    ${EndIf}
  ${EndIf}
!macroend

Function DetectExistingInstall
  StrCpy $DetectedInstallDir ""
  !insertmacro TryExistingInstall HKLM 64
  !insertmacro TryExistingInstall HKCU 64
  !insertmacro TryExistingInstall HKLM 32
  !insertmacro TryExistingInstall HKCU 32

  ; 兼容此前补丁创建的默认目录和早期模板门店常见安装目录。
  ${If} ${FileExists} "$LOCALAPPDATA\Programs\${APP_DIR}\${APP_EXE}"
    StrCpy $DetectedInstallDir "$LOCALAPPDATA\Programs\${APP_DIR}"
    Return
  ${EndIf}
FunctionEnd

Function .onInit
  !ifndef TEST_INSTALL_DIR
    Call DetectExistingInstall
    ${If} $DetectedInstallDir == ""
      MessageBox MB_OK|MB_ICONEXCLAMATION "补丁没有自动找到旧版安装目录。接下来请选择原软件所在的文件夹；补丁不会另建一套空白系统。"
      nsDialogs::SelectFolderDialog "请选择原门店进销存系统所在文件夹" "$PROGRAMFILES64"
      Pop $0
      ${If} $0 == "error"
        Abort
      ${EndIf}
      ${IfNot} ${FileExists} "$0\${APP_EXE}"
        MessageBox MB_OK|MB_ICONSTOP "所选文件夹中没有找到原门店进销存程序。为避免产生隔离数据，本次更新已停止。"
        Abort
      ${EndIf}
      StrCpy $INSTDIR $0
    ${Else}
      StrCpy $INSTDIR $DetectedInstallDir
    ${EndIf}
  !endif
  ; 独立覆盖补丁不读取旧版卸载信息，也不会调用旧卸载器。
  ; 真实更新时先结束应用主进程及其本地服务子进程，避免文件被占用。
  ; 隔离验收包不触碰用户电脑上已运行的门店程序。
  !ifndef TEST_INSTALL_DIR
    nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXE}"'
    Pop $0
    Pop $1
    Sleep 1200
  !endif
FunctionEnd

Section "更新程序文件" SEC_MAIN
  SetOutPath "$PLUGINSDIR"
  File "/oname=payload.7z" "${PATCH_PAYLOAD_FILE}"
  File "/oname=7za.exe" "${PATCH_7ZA_FILE}"

  CreateDirectory "$INSTDIR"
  DetailPrint "正在覆盖程序文件（不会覆盖门店数据库）……"
  nsExec::ExecToStack '"$PLUGINSDIR\7za.exe" x -y -aoa "-o$INSTDIR" "$PLUGINSDIR\payload.7z"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "补丁文件解压失败（错误代码：$0）。请把本窗口截图发给技术人员，现有门店数据不会被删除。"
    Abort
  ${EndIf}

  FileOpen $0 "$INSTDIR\当前版本.txt" w
  FileWrite $0 "门店进销存系统版本：${PATCH_VERSION}$\r$\n"
  FileWrite $0 "更新方式：独立覆盖补丁（不调用旧卸载器）$\r$\n"
  FileClose $0

  !ifndef TEST_INSTALL_DIR
    ; 先清理“所有用户”桌面/开始菜单中的旧图标，再创建当前用户的新图标。
    SetShellVarContext all
    Delete "$DESKTOP\门店进销存系统.lnk"
    Delete "$DESKTOP\门店进销存管理系统.lnk"
    Delete "$DESKTOP\门店经营进销存管理系统.lnk"
    Delete "$DESKTOP\门店进销存管理系统（模板门店版）.lnk"
    Delete "$DESKTOP\开源餐饮库存审查版.lnk"
    RMDir /r "$SMPROGRAMS\开源餐饮库存审查版"
    RMDir /r "$SMPROGRAMS\门店经营进销存管理系统"
    SetShellVarContext current
    ; 只清理本产品过去使用过的明确快捷方式名称，避免桌面同时留下新旧两个图标。
    Delete "$DESKTOP\门店进销存系统.lnk"
    Delete "$DESKTOP\门店进销存管理系统.lnk"
    Delete "$DESKTOP\门店经营进销存管理系统.lnk"
    Delete "$DESKTOP\门店进销存管理系统（模板门店版）.lnk"
    Delete "$DESKTOP\开源餐饮库存审查版.lnk"
    RMDir /r "$SMPROGRAMS\开源餐饮库存审查版"
    RMDir /r "$SMPROGRAMS\门店经营进销存管理系统"
    CreateShortCut "$DESKTOP\门店进销存系统.lnk" "$INSTDIR\${APP_EXE}"
    CreateDirectory "$SMPROGRAMS\门店进销存系统"
    CreateShortCut "$SMPROGRAMS\门店进销存系统\门店进销存系统.lnk" "$INSTDIR\${APP_EXE}"
  !endif
SectionEnd
