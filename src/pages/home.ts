export const homePage = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>Spotify Plus Lyrics</title>

    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            background: #121212;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }

        .container {
            width: 100%;
            max-width: 560px;
        }

        .header {
            margin-bottom: 32px;
        }

        .header h1 {
            margin: 0 0 8px;
            font-size: 36px;
            font-weight: 700;
            letter-spacing: -1.2px;
        }

        .header p {
            margin: 0;
            color: #b3b3b3;
            font-size: 16px;
            line-height: 1.5;
        }

        .card {
            background: #181818;
            border-radius: 12px;
            padding: 28px;
        }

        .field {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 600;
        }

        .optional {
            color: #727272;
            font-weight: 400;
        }

        input {
            width: 100%;
            height: 48px;
            padding: 0 14px;
            border: 1px solid #727272;
            border-radius: 4px;
            background: transparent;
            color: #ffffff;
            font-size: 15px;
            outline: none;
            transition: border-color 0.15s;
        }

        input:hover {
            border-color: #ffffff;
        }

        input:focus {
            border: 2px solid #ffffff;
        }

        input::placeholder {
            color: #727272;
        }

        .file-input {
            display: none;
        }

        .file-picker {
            width: 100%;
            min-height: 110px;
            border: 1px dashed #727272;
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            padding: 20px;
            text-align: center;
            transition: background 0.15s, border-color 0.15s;
        }

        .file-picker:hover,
        .file-picker.dragging {
            background: #242424;
            border-color: #ffffff;
        }

        .file-title {
            font-size: 15px;
            font-weight: 600;
            margin-bottom: 5px;
        }

        .file-name {
            color: #b3b3b3;
            font-size: 13px;
            word-break: break-all;
        }

        button {
            width: 100%;
            height: 48px;
            margin-top: 8px;
            border: 0;
            border-radius: 999px;
            background: #1ed760;
            color: #000000;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: transform 0.1s, background 0.15s;
        }

        button:hover:not(:disabled) {
            background: #3be477;
            transform: scale(1.01);
        }

        button:active:not(:disabled) {
            transform: scale(0.99);
        }

        button:disabled {
            background: #535353;
            color: #a7a7a7;
            cursor: not-allowed;
        }

        .message {
            display: none;
            margin-top: 20px;
            border-radius: 8px;
            padding: 14px 16px;
            font-size: 14px;
            line-height: 1.4;
        }

        .message.success {
            display: block;
            background: rgba(30, 215, 96, 0.12);
            color: #67e895;
        }

        .message.error {
            display: block;
            background: rgba(242, 85, 85, 0.12);
            color: #ff8585;
        }

        .footer {
            margin-top: 24px;
            text-align: center;
            color: #727272;
            font-size: 13px;
        }

        .footer a {
            color: #b3b3b3;
            text-decoration: none;
        }

        .footer a:hover {
            color: #ffffff;
            text-decoration: underline;
        }

        @media (max-width: 600px) {
            body {
                align-items: flex-start;
                padding: 24px 16px;
            }

            .header h1 {
                font-size: 30px;
            }

            .card {
                padding: 22px;
            }
        }
    </style>
</head>

<body>
    <main class="container">
        <div class="header">
            <h1>Submit Lyrics</h1>
            <p>
                Have a lyrics file that you would like to submit to Spotify Plus? You can upload them here!
            </p>
        </div>

        <div class="card">
            <form id="lyrics-form">
                <div class="field">
                    <label for="spotify-id">Spotify Track ID</label>
                    <input
                        id="spotify-id"
                        type="text"
                        maxlength="22"
                        placeholder="7bxaFZ1O3cHkgLKMsdC3xR"
                        required
                    >
                </div>

                <div class="field">
                    <label>
                        Lyrics File
                    </label>

                    <input
    id="lyrics-file"
    class="file-input"
    type="file"
    accept=".json,.ttml,.xml,.lrc"
    required
>

<label class="file-picker" for="lyrics-file" id="file-picker">
    <span class="file-title">Choose a lyrics file</span>
    <span class="file-name" id="file-name">JSON, TTML, or enriched LRC</span>
</label>
                </div>

                <div class="field">
                    <label for="username">
                        Username <span class="optional">(optional)</span>
                    </label>

                    <input
                        id="username"
                        type="text"
                        maxlength="64"
                        placeholder="Username"
                    >
                </div>

                <div class="field">
                    <label for="avatar">
                        Avatar URL <span class="optional">(optional)</span>
                    </label>

                    <input
                        id="avatar"
                        type="url"
                        placeholder="https://cdn.discordapp.com/avatars/"
                    >
                </div>

                <button id="submit-button" type="submit">
                    Submit Lyrics
                </button>

                <div id="message" class="message"></div>
            </form>
        </div>

        <div class="footer">
            Spotify Plus Lyrics API · <a href="https://www.github.com/LeNerd46/SpotifyPlus">GitHub</a>
        </div>
    </main>

    <script>
    const form = document.getElementById('lyrics-form');
    const fileInput = document.getElementById('lyrics-file');
    const filePicker = document.getElementById('file-picker');
    const fileName = document.getElementById('file-name');
    const submitButton = document.getElementById('submit-button');
    const message = document.getElementById('message');

    const supportedExtensions = ['json', 'ttml', 'xml', 'lrc'];

    const getFileExtension = file => {
        return file.name.split('.').pop()?.toLowerCase() ?? '';
    };

    const isSupportedFile = file => {
        return supportedExtensions.includes(getFileExtension(file));
    };

    const updateFile = file => {
        if (!file) {
            fileName.textContent = 'JSON, TTML, XML, or enriched LRC';
            return;
        }

        if (!isSupportedFile(file)) {
            fileInput.value = '';
            fileName.textContent = 'JSON, TTML, XML, or enriched LRC';
            showError('Unsupported lyrics file. Please use JSON, TTML, XML, or LRC.');
            return;
        }

        fileName.textContent = file.name;
        message.className = 'message';
        message.textContent = '';
    };

    fileInput.addEventListener('change', () => {
        updateFile(fileInput.files?.[0]);
    });

    filePicker.addEventListener('dragover', event => {
        event.preventDefault();
        filePicker.classList.add('dragging');
    });

    filePicker.addEventListener('dragleave', () => {
        filePicker.classList.remove('dragging');
    });

    filePicker.addEventListener('drop', event => {
        event.preventDefault();
        filePicker.classList.remove('dragging');

        const file = event.dataTransfer?.files?.[0];
        if (!file) return;

        if (!isSupportedFile(file)) {
            showError('Unsupported lyrics file. Please use JSON, TTML, XML, or LRC.');
            return;
        }

        const transfer = new DataTransfer();
        transfer.items.add(file);

        fileInput.files = transfer.files;
        updateFile(file);
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();

        message.className = 'message';
        message.textContent = '';

        const spotifyId = document.getElementById('spotify-id').value.trim();
        const username = document.getElementById('username').value.trim();
        const avatar = document.getElementById('avatar').value.trim();
        const file = fileInput.files?.[0];

        if (!/^[a-zA-Z0-9]{22}$/.test(spotifyId)) {
            showError('Please enter a valid Spotify track ID.');
            return;
        }

        if (!file) {
            showError('Please select a lyrics file.');
            return;
        }

        const extension = getFileExtension(file);
        const fileText = await file.text();

        let format;
        let lyrics;

        try {
            switch (extension) {
                case 'json':
                    format = 'json';
                    lyrics = JSON.parse(fileText);
                    break;

                case 'ttml':
                case 'xml':
                    format = 'ttml';
                    lyrics = fileText;
                    break;

                case 'lrc':
                    format = 'lrc';
                    lyrics = fileText;
                    break;

                default:
                    showError('Unsupported lyrics file.');
                    return;
            }
        } catch {
            showError('The selected JSON file is not valid JSON.');
            return;
        }

        const body = {
            format,
            lyrics
        };

        if (username) {
            body.user = {
                username,
                ...(avatar && { avatar })
            };
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Submitting...';

        try {
            const response = await fetch('/api/lyrics/' + encodeURIComponent(spotifyId), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            const result = await response.json().catch(() => null);

            if (!response.ok) {
                throw new Error(result?.error || 'Failed to submit lyrics');
            }

            message.className = 'message success';
            message.textContent = 'Lyrics submitted successfully!';
        } catch (error) {
            showError(error instanceof Error ? error.message : 'Failed to submit lyrics');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Submit Lyrics';
        }
    });

    function showError(text) {
        message.className = 'message error';
        message.textContent = text;
    }
</script>
</body>
</html>
`;