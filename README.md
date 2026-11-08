# Gojo Bar

Stock control for Gojo Bar: daily sales, stock given to the barman, draft bermils and the CBE cash book.
It runs in the browser, works on iPhone from the home screen, keeps working without internet and syncs when the connection is back.
The page is hosted free on GitHub Pages. The data is stored in your own free Firebase project, protected by your login.

Author: Tewele B.

## Files

| File | What it is |
|---|---|
| index.html | The page and its look |
| app.js | The app (calculations, screens, saving) |
| firebase-config.js | Your Firebase settings (you fill this in) |
| firestore.rules | Who may read and change the data (you paste this into Firebase) |
| manifest.webmanifest, sw.js, icons/ | Home screen icon and offline use |

Your data file **gojo-data.json** is NOT in this folder on purpose. Never upload it to GitHub: the repository is public.

## Part 1: Create the free database (Firebase), about 10 minutes

1. Go to https://console.firebase.google.com and sign in with your Google account.
2. Click **Create a project**. Name it `gojo-bar`. Turn Google Analytics off. Click **Create project**.
3. In the left menu open **Build > Authentication**, click **Get started**.
4. On the **Sign-in method** tab choose **Email/Password**, switch it on, click **Save**.
5. On the **Users** tab click **Add user**. Type your email and a strong password. This is the login for the app.
6. In the left menu open **Build > Firestore Database**, click **Create database**.
7. Choose a location (for example `europe-west1`), choose **Start in production mode**, click **Create**.
8. Open the **Rules** tab. Delete what is there and paste everything from `firestore.rules`.
   Replace `YOUR-EMAIL@example.com` with the email from step 5. Click **Publish**.
9. Click the gear icon next to **Project Overview**, then **Project settings**.
   Under **Your apps** click the web icon `</>`. Name it `Gojo Bar` and click **Register app**
   (do not tick Firebase Hosting).
10. Firebase shows a `firebaseConfig` block. Copy each value into `firebase-config.js`
    (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId). Save the file.

## Part 2: Put the app online (GitHub Pages), about 5 minutes

1. Sign in at https://github.com and click **New repository**. Name it `gojo-bar`, keep it **Public**, click **Create repository**.
2. Click **uploading an existing file** and drag in everything from this folder:
   `index.html`, `app.js`, `firebase-config.js`, `manifest.webmanifest`, `sw.js`, `firestore.rules`, `README.md`, `.gitignore` and the `icons` folder.
   Click **Commit changes**.
3. Open **Settings > Pages**. Under **Build and deployment** choose **Deploy from a branch**, branch **main**, folder **/ (root)**. Click **Save**.
4. Wait 1 to 2 minutes. Your app address is `https://YOUR-GITHUB-NAME.github.io/gojo-bar/`.
5. Back in Firebase open **Authentication > Settings > Authorized domains**, click **Add domain** and add `YOUR-GITHUB-NAME.github.io`.

If you use git on your computer instead:

```bash
cd gojo-bar
git init && git add . && git commit -m "Gojo Bar app"
git branch -M main
git remote add origin https://github.com/YOUR-GITHUB-NAME/gojo-bar.git
git push -u origin main
```

## Part 3: Load your records, one time only

1. On your computer open `https://YOUR-GITHUB-NAME.github.io/gojo-bar/` and sign in.
2. The app says the database is empty. Click **Choose file** and pick `gojo-data.json`.
3. Confirm. Your sales, deliveries and cash book from the Excel appear.

## Part 4: Put it on your iPhone

1. Open the app address in **Safari** on the iPhone.
2. Tap the **Share** button (square with an arrow), then **Add to Home Screen**, then **Add**.
3. Open Gojo Bar from the new icon and sign in once. It stays signed in.

## Daily use

| What happened | Where to type it |
|---|---|
| Items sold today, money received | **Sales**, then **Save day** |
| Stock given to the barman | **Given** (one tap for 1 bermil of draft) |
| Money paid out (purchases, rent, salary) | **Money** |
| Physical count | **Stock**, tap the item |
| Prices, re-order levels, backup | **Prices** (top right) |

Sold goes in **Sales**. Given to the barman goes in **Given**.

## Backup

Once a month open **Prices > Backup** and tap **Export to Excel** and **Download full backup**. Keep the files safe (not on GitHub).

## Cost

Firebase's free Spark plan allows 50,000 reads and 20,000 writes per day. This app uses a few dozen per day, so it stays free.

## Changing the app later

Edit the files on GitHub and commit. Phones pick up the new version the next time they open the app online.
