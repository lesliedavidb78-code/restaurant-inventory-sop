; 修复包只覆盖现有程序文件，不调用旧版本的卸载程序。
; 旧版卸载程序会自行检查后台进程，且在部分电脑上会误判“无法关闭”。
; 先结束精确同名进程，再让默认安装段跳过旧卸载流程，保留数据和快捷方式。
!macro customInit
  nsExec::ExecToStack 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Pop $1
  Sleep 800
  StrCpy $installMode "CurrentUser"
  SetShellVarContext current
  StrCpy $INSTDIR "$LocalAppData\Programs\${APP_FILENAME}"
!macroend

!macro customCheckAppRunning
  ; customInit 已结束同名进程。即使 taskkill 因目标不存在而返回错误，也必须继续覆盖安装。
!macroend
