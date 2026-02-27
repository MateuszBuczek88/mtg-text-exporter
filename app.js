document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const setCodeInput = document.getElementById('set-code');
    const setSuggestions = document.getElementById('set-suggestions');
    const fontSizeInput = document.getElementById('fontSize') || document.getElementById('font-size');
    const fetchBtn = document.getElementById('fetch-btn');
    const exportBtn = document.getElementById('export-btn');
    const loader = document.getElementById('fetch-loader');
    const statusMsg = document.getElementById('status-message');
    const previewContent = document.getElementById('preview-content');

    // State
    let fetchedCards = [];
    let formattedText = "";
    let allSets = [];

    // Search and Autocomplete Logic
    async function initSetsAutocomplete() {
        try {
            const response = await fetch('https://api.scryfall.com/sets');
            const data = await response.json();
            allSets = data.data;
        } catch (error) {
            console.error("Failed to load sets", error);
        }

        function formatSetLabel(set) {
            const code = set.code.toUpperCase();
            const name = set.name;
            let releasedStr = "";
            if (set.released_at) {
                const [year, month, day] = set.released_at.split('-');
                const date = new Date(year, parseInt(month) - 1, day);
                const monthName = date.toLocaleString('default', { month: 'long' });
                releasedStr = ` released ${monthName} ${year}`;
            }
            return `${code} - ${name}${releasedStr}`;
        }

        function renderSuggestions(filterText = "") {
            filterText = filterText.toLowerCase().trim();
            const filteredSets = allSets.filter(set => {
                const searchStr = `${set.code} ${set.name}`.toLowerCase();
                return searchStr.includes(filterText);
            });

            setSuggestions.innerHTML = '';

            if (filteredSets.length === 0) {
                const li = document.createElement('li');
                li.className = 'suggestion-item';
                li.textContent = 'No sets found';
                setSuggestions.appendChild(li);
            } else {
                filteredSets.forEach(set => {
                    const li = document.createElement('li');
                    li.className = 'suggestion-item';
                    li.textContent = formatSetLabel(set);

                    li.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        setCodeInput.value = set.code;
                        setCodeInput.dataset.code = set.code;
                        setSuggestions.classList.add('hidden');
                    });

                    setSuggestions.appendChild(li);
                });
            }
        }

        setCodeInput.addEventListener('focus', () => {
            renderSuggestions(setCodeInput.value);
            setSuggestions.classList.remove('hidden');
        });

        setCodeInput.addEventListener('input', () => {
            delete setCodeInput.dataset.code;
            renderSuggestions(setCodeInput.value);
            setSuggestions.classList.remove('hidden');
        });

        setCodeInput.addEventListener('blur', () => setSuggestions.classList.add('hidden'));

        renderSuggestions();
    }

    initSetsAutocomplete();

    // API Helper
    async function fetchSetCards(setCode) {
        let cards = [];
        let url = `https://api.scryfall.com/cards/search?q=set:${setCode}`;

        while (url) {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.details || 'Failed to fetch set.');
                }
                const data = await response.json();
                cards = cards.concat(data.data);

                url = data.has_more ? data.next_page : null;

                if (url) {
                    statusMsg.textContent = `Fetched ${cards.length} cards...`;
                    // Brief pause to respect rate limits (Scryfall requests 50-100ms delay, increasing to 500ms as requested)
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.error("Scryfall API Error:", error);
                throw error;
            }
        }
        return cards;
    }

    // Format card data for text ingestion
    function formatCardText(card) {
        // Handle double-faced cards which might have multiple card faces
        let faces = [];
        if (card.card_faces && !card.image_uris) {
            faces = card.card_faces;
        } else {
            faces = [card];
        }

        let text = [];
        faces.forEach((face, index) => {
            if (faces.length > 1) {
                text.push(`--- Face ${index + 1} ---`);
            }

            const nameStr = face.name || card.name;
            const manaStr = face.mana_cost ? ` | Cost: ${face.mana_cost}` : '';
            text.push(`Name: ${nameStr}${manaStr}`);

            // Add color identity (usually on the main card object)
            // It's an array of color characters (e.g. ["W", "U"])
            const colorIdentity = card.color_identity;
            if (colorIdentity && colorIdentity.length > 0) {
                text.push(`Color Identity: ${colorIdentity.join(', ')}`);
            } else if (colorIdentity && colorIdentity.length === 0) {
                text.push(`Color Identity: Colorless`);
            }

            // Add color indicator if present (can be on face or card)
            const colorIndicator = face.color_indicator || card.color_indicator;
            if (colorIndicator && colorIndicator.length > 0) {
                text.push(`Color Indicator: ${colorIndicator.join(', ')}`);
            }

            if (face.type_line || card.type_line) {
                text.push(`Type: ${face.type_line || card.type_line}`);
            }

            if (face.oracle_text || card.oracle_text) {
                text.push(`Oracle Text:\n${face.oracle_text || card.oracle_text}`);
            }

            if (face.power && face.toughness) {
                text.push(`Stats: ${face.power}/${face.toughness}`);
            } else if (card.power && card.toughness) {
                text.push(`Stats: ${card.power}/${card.toughness}`);
            }

            if (face.loyalty || card.loyalty) {
                text.push(`Loyalty: ${face.loyalty || card.loyalty}`);
            }

            if (face.flavor_text || card.flavor_text) {
                text.push(`Flavor: "${face.flavor_text || card.flavor_text}"`);
            }
        });

        text.push("\n=========================================\n");
        return text.join('\n');
    }

    // Event Listeners
    fetchBtn.addEventListener('click', async () => {
        let setCode = setCodeInput.dataset.code || setCodeInput.value.trim();

        if (!setCodeInput.dataset.code && setCode.includes(' - ')) {
            setCode = setCode.split(' - ')[0].trim();
        }

        setCode = setCode.toLowerCase();

        if (!setCode) {
            showError("Please enter a valid set code.");
            return;
        }

        // Reset state
        fetchBtn.disabled = true;
        exportBtn.disabled = true;
        loader.classList.remove('hidden');
        setCodeInput.disabled = true;
        statusMsg.className = 'status-message text-info';
        statusMsg.textContent = `Fetching cards for set '${setCode}'...`;
        previewContent.innerHTML = '<p class="empty-state">Loading data...</p>';
        fetchedCards = [];
        formattedText = "";

        try {
            fetchedCards = await fetchSetCards(setCode);

            if (fetchedCards.length === 0) {
                showError(`No cards found for set '${setCode}'.`);
                return;
            }

            // Sort cards by collector number or name for consistency
            fetchedCards.sort((a, b) => {
                const numA = parseInt(a.collector_number) || 0;
                const numB = parseInt(b.collector_number) || 0;
                return numA - numB;
            });

            // Format all chunks
            let textChunks = [];
            textChunks.push(`MTG Data Export - Set: ${setCode.toUpperCase()}`);
            textChunks.push(`Total Cards: ${fetchedCards.length}`);
            textChunks.push(`Generated for NotebookLM Ingestion\n`);
            textChunks.push(`=========================================\n\n`);

            fetchedCards.forEach(card => {
                textChunks.push(formatCardText(card));
            });

            formattedText = textChunks.join('\n');

            // Update UI
            statusMsg.className = 'status-message text-success';
            statusMsg.textContent = `Successfully fetched and processed ${fetchedCards.length} cards.`;

            // Show preview (limited to first 5000 chars to avoid locking the DOM)
            const previewText = formattedText.length > 5000
                ? formattedText.substring(0, 5000) + '...\n\n[Preview truncated safely. Full text will be exported.]'
                : formattedText;

            previewContent.textContent = previewText;

            // Enable export
            exportBtn.disabled = false;

        } catch (error) {
            showError(`Error: ${error.message}`);
        } finally {
            fetchBtn.disabled = false;
            loader.classList.add('hidden');
            setCodeInput.disabled = false;
        }
    });

    exportBtn.addEventListener('click', () => {
        if (!formattedText) return;

        const setCode = setCodeInput.value.trim().toLowerCase() || 'unknown';
        const fontSize = parseInt(fontSizeInput.value) || 10;

        try {
            statusMsg.className = 'status-message text-info';
            statusMsg.textContent = "Generating PDF...";
            exportBtn.disabled = true;

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
                orientation: 'p',
                unit: 'pt',
                format: 'a4'
            });

            doc.setFont("helvetica", "normal");
            doc.setFontSize(fontSize);

            const margin = 40;
            const pageHeight = doc.internal.pageSize.getHeight();
            const maxLineWidth = doc.internal.pageSize.getWidth() - (margin * 2);

            // Split text by lines that fit the page width
            const splitText = doc.splitTextToSize(formattedText, maxLineWidth);

            let cursorY = margin;

            for (let i = 0; i < splitText.length; i++) {
                if (cursorY > pageHeight - margin) {
                    doc.addPage();
                    cursorY = margin;
                }

                doc.text(splitText[i], margin, cursorY);
                cursorY += (fontSize * 1.2); // Line height
            }

            doc.save(`mtg_set_${setCode}_notebooklm.pdf`);

            statusMsg.className = 'status-message text-success';
            statusMsg.textContent = "PDF Exported Successfully!";
            exportBtn.disabled = false;

        } catch (error) {
            console.error("PDF generation failed", error);
            showError("Failed to generate PDF. See console.");
            exportBtn.disabled = false;
        }
    });

    function showError(msg) {
        statusMsg.className = 'status-message text-error';
        statusMsg.textContent = msg;
        previewContent.innerHTML = `<p class="empty-state">Failed to load data.</p>`;
    }
});
