CLOSE DATABASES ALL
LOCAL nMonth, nYear, fastDirectory, folderName, folderPath, dbfPath
LOCAL loDir, i, dStart, dEnd, nRecalled, nTotalRecalled, cLogFile, hLog

* Target month/year - closes this month AND all months back to dStart
nMonth = 09
nYear  = 2026

* Explicit boundaries - adjust dStart if your data range changes
dStart = DATE(2024, 1, 1)
dEnd   = GOMONTH(DATE(nYear, nMonth, 1), 1) - 1

fastDirectory = "\\192.168.0.234\fast_system\"

* Log file - one per run, timestamped
cLogFile = "recall_log_" + TTOC(DATETIME(), 1) + ".txt"
hLog = FCREATE(cLogFile)
IF hLog < 0
    ? "WARNING: Could not create log file. Continuing without file logging."
ENDIF

nTotalRecalled = 0

= WriteLog(hLog, "Recall run started: " + TTOC(DATETIME()))
= WriteLog(hLog, "Date range: " + DTOC(dStart) + " to " + DTOC(dEnd))
= WriteLog(hLog, REPLICATE("-", 60))

DIMENSION aFolders[1]
loDir = ADIR(aFolders, fastDirectory + "*.*", "D")

IF loDir > 0
    FOR i = 1 TO loDir
        IF "D" $ aFolders[i,5] AND aFolders[i,1] <> "." AND aFolders[i,1] <> ".."
            folderName = aFolders[i,1]
            folderPath = ADDBS(fastDirectory + folderName)
            dbfPath = folderPath + "dbase\monthly.dbf"

            IF FILE(dbfPath)
                ? "Recalling " + DTOC(dStart) + " to " + DTOC(dEnd) + ": " + dbfPath
                USE (dbfPath) SHARED ALIAS monthlyDbf IN 0
                SELECT monthlyDbf

                * Log each record that WILL be recalled, before we recall it
                * (once recalled, DELETED() will already be .F., so we check pre-state)
                SCAN FOR DELETED() AND trans_date >= dStart AND trans_date <= dEnd
                    = WriteLog(hLog, "  [" + folderName + "] Recno: " + ;
                        TRANSFORM(RECNO()) + " | trans_date: " + DTOC(trans_date) + ;
                        " | " + PadRecordSummary())
                ENDSCAN

                RECALL FOR trans_date >= dStart AND trans_date <= dEnd
                nRecalled = _TALLY

                ? "  -> " + TRANSFORM(nRecalled) + " record(s) recalled"
                = WriteLog(hLog, folderName + ": " + TRANSFORM(nRecalled) + " record(s) recalled")

                nTotalRecalled = nTotalRecalled + nRecalled

                USE IN monthlyDbf
            ELSE
                ? "File not found: " + dbfPath
                = WriteLog(hLog, folderName + ": FILE NOT FOUND - " + dbfPath)
            ENDIF
        ENDIF
    ENDFOR
ELSE
    ? "No folders found."
    = WriteLog(hLog, "No folders found in " + fastDirectory)
ENDIF

= WriteLog(hLog, REPLICATE("-", 60))
= WriteLog(hLog, "Total records recalled: " + TRANSFORM(nTotalRecalled))
= WriteLog(hLog, "Recall run finished: " + TTOC(DATETIME()))

IF hLog >= 0
    = FCLOSE(hLog)
ENDIF

? "Done. Total recalled: " + TRANSFORM(nTotalRecalled)
? "Log written to: " + cLogFile

RETURN

*----------------------------------------------------
PROCEDURE WriteLog(hFile, cLine)
    ? cLine
    IF hFile >= 0
        = FPUTS(hFile, cLine)
    ENDIF
ENDPROC

*----------------------------------------------------
FUNCTION PadRecordSummary
    * Optional: add any other fields you want visible per recalled record
    * Adjust field names to match your actual monthly.dbf structure
    LOCAL cSummary
    cSummary = ""
    IF TYPE("monthlyDbf.acct_no") = "C"
        cSummary = "acct_no: " + ALLTRIM(monthlyDbf.acct_no)
    ENDIF
    RETURN cSummary
ENDFUNC