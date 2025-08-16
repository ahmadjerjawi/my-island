document.addEventListener('DOMContentLoaded', async () => {
    // --- CONFIG ---
    const SUPABASE_URL = 'https://hrsbvguvsrdrjcukbdlc.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_kNDUBTOR4sthXqbgMosTjA_aLekCeLz';
    const PLACE_ID = '118648755816733';

    // --- TIMER LOGIC ---
    const WAIT_PERIOD = 45 * 60;
    const EVENT_DURATION = 15 * 60;
    const SINGLE_EVENT_CYCLE = WAIT_PERIOD + EVENT_DURATION; // 60 minutes
    const FULL_CYCLE_DURATION = SINGLE_EVENT_CYCLE * 2;      // 120 minutes total
    const WARNING_PERIOD = 5 * 60;
    const MAX_PLAYERS = 8;
    const JOINED_SERVER_GRACE_PERIOD = 45 * 60 * 1000; // 45 minutes in milliseconds

    // --- STATE ---
    let serverData = [];
    let sortMode = 'soonest';
    let filterMode = 'all';
    let joinedServers = new Map(); // Stores { serverId: { phase, joinedAt } }

    // --- UI ELEMENTS ---
    const loadingContainer = document.getElementById('loading-container');
    const serverListContainer = document.getElementById('server-list-container');
    const errorContainer = document.getElementById('error-container');
    const sortSelect = document.getElementById('sort-select');
    const filterButtonsContainer = document.getElementById('filter-buttons');
    const joinByIdInput = document.getElementById('join-by-id-input');
    const joinByIdBtn = document.getElementById('join-by-id-btn');

    const { createClient } = window.supabase;
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

    // --- EVENT LISTENERS ---
    sortSelect?.addEventListener('change', (e) => { sortMode = e.target.value; updateAndRender(); });
    filterButtonsContainer?.addEventListener('click', (e) => {
        const button = e.target.closest('.chip');
        if (!button) return;
        filterMode = button.dataset.filter;
        filterButtonsContainer.querySelectorAll('.chip').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        updateAndRender();
    });
    joinByIdBtn?.addEventListener('click', joinById);
    joinByIdInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinById();
    });

    // --- MAIN EXECUTION ---
    loadJoinedServers();
    await fetchData();
    initializeCustomSelects();
    setInterval(updateAndRender, 1000);
    setInterval(fetchData, 30 * 1000);

    // --- FUNCTIONS ---
    function joinById() {
        const serverId = joinByIdInput.value.trim();
        if (serverId.length < 36) { // Basic validation for GUID format
            toast('Invalid Server ID format.');
            return;
        }
        toast(`Attempting to join server: ${serverId.substring(0, 8)}...`);
        // --- MODIFIED: Changed to prevent opening a new tab ---
        window.location.href = `roblox://placeId=${PLACE_ID}&gameInstanceId=${serverId}`;
        joinByIdInput.value = '';
    }

    async function fetchData() {
        try {
            const { data, error } = await sb.from('servers').select('*').eq('status', 'active');
            if (error) throw error;
            serverData = data.filter(s => s.player_count < MAX_PLAYERS);
            loadingContainer.style.display = 'none';
            serverListContainer.style.display = 'flex';
            errorContainer.style.display = 'none';
            updateAndRender();
        } catch (err) {
            console.error('Error fetching data:', err);
            showError(`Failed to fetch server data: ${err.message}. Ensure RLS is enabled.`);
        }
    }

    function getEventStatus(server) {
        const ageSeconds = (Date.now() - new Date(server.first_seen).getTime()) / 1000;
        const timeInCycle = ageSeconds % FULL_CYCLE_DURATION;

        let status = { age: ageSeconds, cycles_since_seen: server.cycles_since_seen };

        if (timeInCycle < SINGLE_EVENT_CYCLE) {
            const timeInFirstHalf = timeInCycle;
            if (timeInFirstHalf < WAIT_PERIOD) {
                status.timeLabel = 'Arrives In:';
                status.timeRemaining = WAIT_PERIOD - timeInFirstHalf;
                status.phase = status.timeRemaining <= WARNING_PERIOD ? 'starting_soon' : 'far';
            } else {
                status.phase = 'active';
                status.timeLabel = 'Leaves In:';
                status.timeRemaining = SINGLE_EVENT_CYCLE - timeInFirstHalf;
            }
        } else {
            const timeInSecondHalf = timeInCycle - SINGLE_EVENT_CYCLE;
            if (timeInSecondHalf < WAIT_PERIOD) {
                status.timeLabel = 'Arrives In:';
                status.timeRemaining = WAIT_PERIOD - timeInSecondHalf;
                status.phase = status.timeRemaining <= WARNING_PERIOD ? 'starting_soon' : 'far';
            } else {
                status.phase = 'active';
                status.timeLabel = 'Leaves In:';
                status.timeRemaining = FULL_CYCLE_DURATION - timeInCycle;
            }
        }
        return { ...server, ...status };
    }

    function updateAndRender() {
        if (!serverData.length) return;

        let processed = serverData.map(getEventStatus);

        const serversToDelete = [];
        joinedServers.forEach((data, serverId) => {
            const currentServer = processed.find(s => s.server_id === serverId);
            const timeSinceJoined = Date.now() - data.joinedAt;

            if (!currentServer || timeSinceJoined > JOINED_SERVER_GRACE_PERIOD) {
                serversToDelete.push(serverId);
            }
        });

        if (serversToDelete.length > 0) {
            serversToDelete.forEach(serverId => joinedServers.delete(serverId));
            saveJoinedServers();
        }

        processed = processed.map(server => ({
            ...server,
            joinedAt: joinedServers.get(server.server_id)?.joinedAt || 0
        }));

        let displayList;
        if (filterMode === 'joined') {
            displayList = processed.filter(s => joinedServers.has(s.server_id));
        } else if (filterMode !== 'all') {
            displayList = processed.filter(s => s.phase === filterMode && !joinedServers.has(s.server_id));
        } else {
            displayList = processed.filter(s => !joinedServers.has(s.server_id));
        }

        displayList.sort((a, b) => {
            switch (sortMode) {
                case 'oldest': return b.age - a.age;
                case 'newest': return a.age - b.age;
                case 'player_high': return b.player_count - a.player_count;
                case 'player_low': return a.player_count - b.player_count;
                case 'join_order':
                    if (filterMode !== 'joined') return 0;
                    return b.joinedAt - a.joinedAt;
                case 'furthest':
                    if (a.phase !== 'active' && b.phase === 'active') return -1;
                    if (a.phase === 'active' && b.phase !== 'active') return 1;
                    return b.timeRemaining - a.timeRemaining;
                case 'soonest':
                default:
                    if (a.phase === 'active' && b.phase !== 'active') return -1;
                    if (a.phase !== 'active' && b.phase === 'active') return 1;
                    return a.timeRemaining - b.timeRemaining;
            }
        });

        renderStats(processed);
        renderServers(displayList, filterMode === 'joined');
    }

    function renderStats(allServers) {
        document.getElementById('total-players').textContent = allServers.reduce((sum, s) => sum + s.player_count, 0).toLocaleString();
        document.getElementById('active-merchants').textContent = allServers.filter(s => s.phase === 'active').length;
        document.getElementById('soon-merchants').textContent = allServers.filter(s => s.phase === 'starting_soon').length;
        document.getElementById('total-servers').textContent = allServers.length;
    }

    function renderServers(servers, isJoinedList) {
        serverListContainer.innerHTML = '';
        if (servers.length === 0) {
            serverListContainer.innerHTML = `<div class="info-box" style="width:100%; text-align:center;">No servers match the current filter.</div>`;
            return;
        }
        servers.forEach(server => serverListContainer.appendChild(createServerCard(server, isJoinedList)));

        document.querySelectorAll('.join-btn').forEach(btn => btn.addEventListener('click', handleJoinClick));
        document.querySelectorAll('.return-btn').forEach(btn => btn.addEventListener('click', handleReturnClick));
        document.querySelectorAll('.copy-id-icon-btn').forEach(el => el.addEventListener('click', handleCopyId));
    }

    function createServerCard(server, isJoined) {
        const card = document.createElement('div');
        card.className = `server-card status-${server.phase}`;
        card.id = `server-${server.server_id}`;

        const staleInfoHTML = server.cycles_since_seen > 0 ? `<span class="info-item stale-info" title="This server was not found in the last scan."><svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>Stale</span>` : '';
        const joinButtonHTML = `<button class="btn btn-success join-btn" data-server-id="${server.server_id}">Join</button>`;
        const returnButtonHTML = isJoined ? `<button class="btn btn-warning return-btn" data-server-id="${server.server_id}">Return</button>` : '';

        const copyElementHTML = `
            <div class="server-id-container">
                <span title="${server.server_id}">ID: ${server.server_id}</span>
                <button class="copy-id-icon-btn" title="Copy Server ID" data-server-id="${server.server_id}">
                    <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                </button>
            </div>`;

        card.innerHTML = `
            <div class="server-card-main">
                <div class="status-dot"></div>
                <div class="server-details">
                    <div class="server-info">
                        <span class="info-item" title="Player Count">${server.player_count}/${MAX_PLAYERS} Players</span>
                        <span class="info-item" title="Event Timer">${server.timeLabel} ${formatTime(server.timeRemaining)}</span>
                        ${staleInfoHTML}
                    </div>
                    <div class="server-meta-info">
                        <span>Age: ${formatAge(server.age)}</span>
                        ${copyElementHTML}
                    </div>
                </div>
            </div>
            <div class="server-actions">
                ${joinButtonHTML}
                ${returnButtonHTML}
            </div>`;
        return card;
    }

    function handleJoinClick(e) {
        const serverId = e.target.dataset.serverId;
        const server = serverData.find(s => s.server_id === serverId);
        if (!server) return;
        const card = document.getElementById(`server-${serverId}`);
        card?.classList.add('highlighted');
        setTimeout(() => card?.classList.remove('highlighted'), 5000);

        joinedServers.set(serverId, {
            phase: getEventStatus(server).phase,
            joinedAt: Date.now()
        });
        saveJoinedServers();

        toast(`Joining Server: ${serverId.substring(0, 8)}...`);
        // --- MODIFIED: Changed to prevent opening a new tab ---
        window.location.href = `roblox://placeId=${PLACE_ID}&gameInstanceId=${serverId}`;
        updateAndRender();
    }

    function handleReturnClick(e) {
        joinedServers.delete(e.target.dataset.serverId);
        saveJoinedServers();
        updateAndRender();
    }

    function handleCopyId(e) {
        const serverId = e.currentTarget.dataset.serverId;
        navigator.clipboard.writeText(serverId).then(() => {
            toast(`Copied Server ID: ${serverId.substring(0, 8)}...`);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            toast('Failed to copy ID.');
        });
    }

    function saveJoinedServers() {
        localStorage.setItem('joinedMerchantServers', JSON.stringify(Array.from(joinedServers.entries())));
    }

    function loadJoinedServers() {
        const stored = localStorage.getItem('joinedMerchantServers');
        if (stored) {
            joinedServers = new Map(JSON.parse(stored));
        }
    }

    function showError(msg) {
        errorContainer.innerHTML = `<div class="info-box error-box">${msg}</div>`;
        errorContainer.style.display = 'block';
    }

    function formatTime(s) { return `${String(Math.floor(s/60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
    function formatAge(s) { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}` : `${m}m`; }
});
