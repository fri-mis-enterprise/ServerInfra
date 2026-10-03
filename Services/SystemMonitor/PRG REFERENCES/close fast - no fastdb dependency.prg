SET DELETED ON
SET CENTURY ON
CLEAR
CLOSE DATABASES ALL

nMonth = 9
nYear = 2026
dDate = CTOD(ALLTRIM(STR(nMonth))+'/01/'+ALLTRIM(STR(nYear)))
cTime = SUBSTR(TTOC(DATETIME()),12,5)+' '+RIGHT(TTOC(DATETIME()),2)

cWorkstation = ALLTRIM(SUBSTR(SYS(0), 1, AT('#', SYS(0)) - 1))
cRoot = "\\192.168.0.234\fast_system\"

* --- Excluded station folders (add more as needed) ---
DIMENSION aExclude(1)
aExclude(1) = 'fastmnv'


* --- Enumerate subfolders under root ---
DIMENSION aDirs(1)
nDirs = ADIR(aDirs, cRoot + '*.*', 'D')

FOR i = 1 TO nDirs
	cName = ALLTRIM(aDirs(i,1))
	IF cName = '.' OR cName = '..'
		LOOP
	ENDIF
	IF !('D' $ aDirs(i,5))
		LOOP && not a directory
	ENDIF

	IF ASCAN(aExclude, cName, 1, -1, 0, 15) > 0
		? '  ' + cName + ' > Excluded'
		LOOP
	ENDIF

	cStationPath = cRoot + cName + '\dbase\'
	cMonthly = cStationPath + 'monthly.dbf'
	cLedger  = cStationPath + 'apledger.dbf'
	cCoa     = cStationPath + 'chracct.dbf'

	IF !(FILE(cMonthly) AND FILE(cLedger) AND FILE(cCoa))
		? '  ' + cName + ' > Skipped (missing dbase files)'
		LOOP
	ENDIF

	? '  ' + cName + ' > Ok '

	USE (cMonthly) IN 0 SHARED ALIAS monthly
	USE (cLedger)  IN 0 SHARED ALIAS apledger
	USE (cCoa)     IN 0 SHARED ALIAS chracct

	SELECT monthly
	LOCATE FOR trans_date = dDate
	IF FOUND()
		?? ' > ' + CMONTH(dDate) + ' already closed'
	ELSE
		?? ' > ' + CMONTH(dDate) + ' still open'

		SELECT acct_no, SUM(debit) AS debit, SUM(credit) AS credit ;
			FROM apledger WHERE YEAR(trn_date) = nYear AND MONTH(trn_date) = nMonth ;
			GROUP BY 1 ORDER BY 1 INTO CURSOR curledger

		SELECT dDate AS trans_date, ;
			   a.acct_no, a.acct_name, a.acct_level, a.norm_bal, ;
			   a.general, PADL(ALLTRIM(STR(nMonth)),2,'0') AS month, ;
			   ALLTRIM(STR(nYear)) AS year, ;
			   IIF(ISNULL(b.debit),00000000.00,b.debit) AS debit, ;
			   IIF(ISNULL(b.credit),00000000.00,b.credit) AS credit, ;
			   .T. AS posted, IIF(ISNULL(b.credit) AND ISNULL(b.debit),.F.,.T.) AS find_data, ;
			   DATE() AS date_post, a.amount AS namount, ;
			   .F. AS lbegin, 'MIS Enterprise' AS user, DATE() AS date, ;
			   cTime AS time, cWorkstation AS workstatio ;
			FROM chracct AS a LEFT JOIN curledger AS b ON a.acct_no = b.acct_no ;
			ORDER BY 2 INTO CURSOR curmonthly READWRITE

		SELECT monthly
		APPEND FROM DBF('curmonthly')
	ENDIF

	IF USED('curledger')
		USE IN curledger
	ENDIF
	IF USED('curmonthly')
		USE IN curmonthly
	ENDIF

	USE IN apledger
	USE IN monthly
	USE IN chracct
NEXT