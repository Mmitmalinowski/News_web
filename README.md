RSS Aggregator — lokalny projekt


Szybkie instrukcje jak uruchomić projekt (Windows PowerShell):

1. Zainstaluj zależności (jeśli jeszcze nie):

```powershell
'cd C:\Users\Maciej\Downloads\Strona-web_news-main\News-web'
npm install
```

2. Otwórz stronę `index.html` przez Live Server (VS Code) lub prosty serwer HTTP.

Uwaga: aplikacja używa publicznych proxy CORS dla produkcji/testów. Opcja lokalnego proxy została usunięta z UI — jeśli chcesz uruchamiać lokalny proxy do debugowania, powiedz mi, a przywrócę instrukcje i opcję w interfejsie.

Problemy z cache i quota
- Jeśli w konsoli widzisz błąd "Setting the value of 'sessionFeedCache' exceeded the quota", wyczyść sessionStorage/localStorage w przeglądarce dla tej strony:

	1. Otwórz DevTools (F12) → Application → Storage → kliknij "Clear site data" lub w konsoli uruchom:
		 ```javascript
		 sessionStorage.removeItem('sessionFeedCache');
		 localStorage.removeItem('sessionFeedCache');
		 localStorage.removeItem('knownFeedUrls');
		 ```
	2. Odśwież stronę.

- Aby wymusić pełne odświeżenie i ponowne pobranie feedów, w konsoli przeglądarki uruchom:
	```javascript
	// localStorage.setItem('proxyPref', 'public'); // polecenie przestarzałe — aplikacja używa teraz publicznych proxy
	location.reload();
	```
