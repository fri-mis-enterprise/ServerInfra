CLOSE DATABASES ALL
LOCAL nMonth, nYear, dStart, dEnd, fastDirectory, stationName, dbfPath

nMonth = 07
nYear  = 2026
dStart = DATE(nYear, nMonth, 1)
dEnd   = GOMONTH(dStart, 1) - 1

stationName   = "fastpa2"
fastDirectory = "\\192.168.0.234\fast_system\"
dbfPath = ADDBS(fastDirectory + stationName) + "dbase\monthly.dbf"

IF FILE(dbfPath)
    ? "Opening: " + dbfPath
    USE (dbfPath) SHARED ALIAS monthlyDbf IN 0
    SELECT monthlyDbf
    DELETE FOR trans_date >= dStart AND trans_date <= dEnd
    ? _TALLY, "records flagged deleted"
    USE IN monthlyDbf
ELSE
    ? "File not found: " + dbfPath
ENDIF