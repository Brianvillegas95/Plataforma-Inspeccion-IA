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
            redirect_uri: window.location.origin,
            audience: AZOR_API_AUDIENCE, 
            scope: 'openid profile email' 
        }
    });
};

// MANEJO DE CALLBACK OPTIMIZADO: Evita procesar si ya hay sesión
const handleRedirectCallback = async () => {
    const query = window.location.search;
    const hasParams = query.includes("code=") && query.includes("state=");
    
    if (hasParams) {
        try {
            // Verificamos si ya estamos autenticados antes de procesar el callback
            // Esto evita el error "Invalid State" al navegar hacia atrás
            const isAuthenticated = await auth0Client.isAuthenticated();
            
            if (!isAuthenticated) {
                await auth0Client.handleRedirectCallback();
            }
            
            // Limpiamos la URL siempre, sin importar el resultado
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (err) {
            console.warn("Callback ignorado o estado expirado:", err.message);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
};

const login = async () => {
    await auth0Client.loginWithRedirect({
         authorizationParams: { audience: AZOR_API_AUDIENCE }
    });
};

const logout = () => {
    auth0Client.logout({
        logoutParams: { returnTo: window.location.origin }
    });
};

const initializeAuth = async (authRequired = false, requiredRoles = []) => {
    await configureClient();
    await handleRedirectCallback(); // Primero limpiamos/procesamos la URL
    await updateUI(authRequired, requiredRoles);
};

const updateUI = async (authRequired, requiredRoles) => {
    // 1. Obtener estado de autenticación
    const isAuthenticated = await auth0Client.isAuthenticated();
    
    // 2. Referencias a elementos
    const protectedContent = document.getElementById('protected-content');
    const loginScreen = document.getElementById('login-screen');
    const logoutButton = document.getElementById('logout-button');
    const kpisLink = document.getElementById('link-kpis');
    const dashboardAjustesLink = document.getElementById('link-dashboard-ajustes');
    const adminMantenimientoLink = document.getElementById('link-admin-mantenimiento');

    // 3. Lógica para NO AUTENTICADOS
    if (!isAuthenticated) {
        if (authRequired) {
             await login(); 
             return; 
        }
        if(protectedContent) protectedContent.style.display = 'none';
        if(loginScreen) loginScreen.style.display = 'block';
        if(logoutButton) logoutButton.style.display = 'none';
        return;
    }
    
    // 4. Lógica para AUTENTICADOS (Roles)
    const CLAIM_URL = 'https://azor-calidad.netlify.app/roles';
    let userRoles = [];

    try {
        const idTokenClaims = await auth0Client.getIdTokenClaims();
        userRoles = idTokenClaims?.[CLAIM_URL] || [];
        
        if (userRoles.length === 0) {
            const accessToken = await auth0Client.getTokenSilently(); 
            const parsedToken = parseJwt(accessToken);
            userRoles = parsedToken?.[CLAIM_URL] || [];
        }
    } catch (e) {
        console.error("Error obteniendo roles:", e);
    }

    // Bloqueo por falta de roles
    if (userRoles.length === 0) {
        logout();
        return;
    }

    // Bloqueo por rol insuficiente
    if (requiredRoles.length > 0) {
        const hasRequiredRole = requiredRoles.some(r => userRoles.includes(r));
        if (!hasRequiredRole) {
            window.location.replace(window.location.origin); 
            return;
        }
    }

    // 5. Mostrar Interfaz Final
    if(loginScreen) loginScreen.style.display = 'none';
    if(protectedContent) protectedContent.style.display = 'block'; 
    if(logoutButton) logoutButton.style.display = 'inline-block';

    // Visibilidad de menú
    const isAdmin = userRoles.includes('admin');
    const isSuperMan = userRoles.includes('super_man');
    const isSuper = userRoles.includes('super');
    
    const canSeeKpis = isAdmin || isSuperMan || isSuper;
    const canSeeAdmin = isAdmin || isSuperMan;

    if (kpisLink) kpisLink.style.display = canSeeKpis ? 'block' : 'none';
    if (dashboardAjustesLink) dashboardAjustesLink.style.display = canSeeKpis ? 'block' : 'none';
    if (adminMantenimientoLink) adminMantenimientoLink.style.display = canSeeAdmin ? 'block' : 'none';
};