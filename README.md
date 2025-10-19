RSS Aggregator — lokalny projekt

Szybkie instrukcje jak uruchomić projekt i lokalne proxy (Windows PowerShell):

1. Zainstaluj zależności (jeśli jeszcze nie):

```powershell
'cd C:\Users\Maciej\Downloads\Strona-web_news-main\News-web'
npm install
```

2. Uruchom lokalne proxy (w oddzielnym terminalu):

```powershell
cd C:\Users\Maciej\Downloads\Strona-web_news-main\News-web
npm run proxy
```

Proxy będzie dostępne pod: http://localhost:3000/proxy?url=

3. Otwórz stronę `index.html` przez Live Server (VS Code) lub prosty serwer HTTP.

4. W interfejsie wybierz "Lokalne proxy" i kliknij "Odśwież".

Uwagi:
- Lokalny proxy ustawia nagłówek CORS (Access-Control-Allow-Origin: *), co pozwala stronie pobierać RSS z innych domen podczas developmentu.
- Nie wdrażaj tej wersji proxy publicznie bez dodatkowych zabezpieczeń.
- Możesz dodawać nowe feedy z UI (nazwa + URL) — zostaną zapisane w localStorage.

Jeśli chcesz, mogę dodać "npm run proxy & npm run start" lub skrypt do równoległego uruchamiania proxy i Live Server; daj znać.

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
	localStorage.setItem('proxyPref', 'public'); // lub 'local' jeśli masz własny proxy
	location.reload();
	```
