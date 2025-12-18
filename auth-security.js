// *** CONSTANTES DE TU APP AZOR-CALIDAD-NETLIFY ***
const AUTH0_DOMAIN = "dev-8nfvmq7g3rifqdu4.us.auth0.com";
const AUTH0_CLIENT_ID = "pQcvfNTw848DR4DtRKKUN8nxcsquGkAo"; 
const AZOR_API_AUDIENCE = "https://azor-calidad.netlify.app"; 

let auth0Client = null;

// Función auxiliar para decodificar JWT
function parseJwt(token) {
    if (!token) return null;
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

const configureClient = async () => {
    auth0Client = await auth0.createAuth0Client({
        domain: AUTH0_DOMAIN,
        clientId: AUTH0_CLIENT_ID,
        authorizationParams: {
            // CAMBIO: Ahora el redirect_uri apunta a la página exacta donde estás
            redirect_uri: window.location.origin + window.location.pathname,
            audience: AZOR_API_AUDIENCE, 
            scope: 'openid profile email' 
        }
    });
};

// MANEJO DE CALLBACK: Modificado para manejar el regreso a la URL específica
const handleRedirectCallback = async () => {
    const query = window.location.search;
    const hasParams = query.includes("code=") && query.includes("state=");
    
    if (hasParams) {
        try {
            const isAuthenticated = await auth0Client.isAuthenticated();
            if (!isAuthenticated) {
                // CAMBIO: Capturamos el appState para saber a qué página volver
                const { appState } = await auth0Client.handleRedirectCallback();
                
                // Limpiamos la URL y nos aseguramos de estar en la ruta correcta
                const targetUrl = appState && appState.targetUrl ? appState.targetUrl : window.location.pathname;
                window.history.replaceState({}, document.title, targetUrl);
            }
        } catch (err) {
            console.warn("Estado de Auth0 expirado o procesado previamente.");
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
};

const login = async () => {
    // CAMBIO: Enviamos la ruta actual en appState y forzamos el redirect_uri dinámico
    await auth0Client.loginWithRedirect({
         authorizationParams: { 
            audience: AZOR_API_AUDIENCE,
            redirect_uri: window.location.origin + window.location.pathname 
         },
         appState: { targetUrl: window.location.pathname }
    });
};

const logout = () => {
    // CAMBIO: Al salir, también especificamos que regrese a la página donde estaba (si es pública)
    // o al origen si prefieres que el logout siempre mande al home.
    auth0Client.logout({
        logoutParams: { returnTo: window.location.origin + window.location.pathname }
    });
};

const initializeAuth = async (authRequired = false, requiredRoles = []) => {
    await configureClient();
    await handleRedirectCallback(); 
    await updateUI(authRequired, requiredRoles);
};

const updateUI = async (authRequired, requiredRoles) => {
    const isAuthenticated = await auth0Client.isAuthenticated();
    
    const protectedContent = document.getElementById('protected-content');
    const loginScreen = document.getElementById('login-screen');

    if(protectedContent) protectedContent.style.display = 'none';
    if(loginScreen) loginScreen.style.display = 'none';

    if (!isAuthenticated) {
        if (authRequired) {
             await login(); 
             return; 
        }
        if(loginScreen) loginScreen.style.display = 'block';
        return;
    }
    
    const CLAIM_URL = 'https://azor-calidad.netlify.app/roles';
    let userRoles = [];
    try {
        const idTokenClaims = await auth0Client.getIdTokenClaims();
        userRoles = idTokenClaims?.[CLAIM_URL] || [];
    } catch (e) { console.error(e); }

    if (userRoles.length > 0) {
        // Validar si el usuario tiene al menos uno de los roles requeridos para esta página
        const hasPermission = requiredRoles.length === 0 || requiredRoles.some(role => userRoles.includes(role));
        
        if (hasPermission) {
            if(protectedContent) protectedContent.style.display = 'block';
            actualizarVisibilidadBotones(userRoles);
        } else {
            alert("No tienes permiso para acceder a esta sección.");
            window.location.href = '/'; // O a una página de "Sin Permisos"
        }
    } else {
        logout();
    }
};

function actualizarVisibilidadBotones(userRoles) {
    const isAdmin = userRoles.includes('admin') || userRoles.includes('super_man');
    const isUser = userRoles.includes('super') || isAdmin;

    const kpis = document.getElementById('link-kpis');
    const dash = document.getElementById('link-dashboard-ajustes');
    const admin = document.getElementById('link-admin-mantenimiento');
    const logoutBtn = document.getElementById('logout-button');

    if (kpis) kpis.style.display = isUser ? 'block' : 'none';
    if (dash) dash.style.display = isUser ? 'block' : 'none';
    if (admin) admin.style.display = isAdmin ? 'block' : 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-block';
}