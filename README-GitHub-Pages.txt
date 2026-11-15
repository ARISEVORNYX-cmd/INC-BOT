NEZUKO HELPER — GitHub Pages upload notes

This is a standalone static website. It does not connect to a GitHub API, bot token, or external API. The invite buttons point to the public Discord invite URL supplied by the owner.

1. Choose the GitHub account/organization name first. GitHub usernames cannot contain spaces; try a unique handle such as `nezubot` or `nezu-bot` (availability is checked by GitHub).
2. If you rename your existing personal account, review GitHub's warnings first: the change affects profile/repository URLs and other references. The owner must make this change in GitHub Settings; this assistant cannot change it directly.
3. Create a repository for the site. For a root address like `https://HANDLE.github.io/`, name the repository `HANDLE.github.io`. For a project address, use any repo name; the URL will look like `https://HANDLE.github.io/REPO/`.
4. Upload `index.html` to the repository's root on the `main` branch.
5. Open repository Settings → Pages. Choose “Deploy from a branch”, select `main` and `/ (root)`, then Save. Wait for GitHub Pages to finish publishing.
6. Share the resulting public Pages URL. This page will show the chosen GitHub handle in its URL. A custom domain is the way to hide the handle while still hosting with GitHub Pages.

Do not upload Discord tokens, `.env` files, passwords, or API keys. The website contains only public site content and the public bot invite link.
