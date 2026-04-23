!macro customInit
  ; Detect system UI language and pre-select installer language
  System::Call 'kernel32::GetUserDefaultUILanguage() i .r0'
  IntCmp $0 0x0412 setKorean setEnglish setKorean
  setKorean:
    StrCpy $LANGUAGE 1042
    Goto langDone
  setEnglish:
    StrCpy $LANGUAGE 1033
  langDone:
!macroend
