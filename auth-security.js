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

// MANEJO DE CALLBACK: Evita errores de estado al navegar o refrescar
const handleRedirectCallback = async () => {
    const query = window.location.search;
    const hasParams = query.includes("code=") && query.includes("state=");
    
    if (hasParams) {
        try {
            // Verificamos si ya hay sesión para no procesar un estado viejo
            const isAuthenticated = await auth0Client.isAuthenticated();
            if (!isAuthenticated) {
                await auth0Client.handleRedirectCallback();
            }
        } catch (err) {
            // Silenciamos el error de estado inválido ya que limpiamos la URL
            console.warn("Estado de Auth0 expirado o procesado previamente.");
        } finally {
            // Limpiamos la URL de parámetros siempre
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
    await handleRedirectCallback(); 
    await updateUI(authRequired, requiredRoles);
};

const updateUI = async (authRequired, requiredRoles) => {
    const isAuthenticated = await auth0Client.isAuthenticated();
    
    const protectedContent = document.getElementById('protected-content');
    const loginScreen = document.getElementById('login-screen');
    const logoutButton = document.getElementById('logout-button');

    // 1. CASO: NO AUTENTICADO
    if (!isAuthenticated) {
        if (authRequired) {
             await login(); 
             return; 
        }
        // Solo mostramos login si estamos seguros de que no hay sesión
        if(protectedContent) protectedContent.style.display = 'none';
        if(loginScreen) loginScreen.style.display = 'block';
        return;
    }
    
    // 2. CASO: AUTENTICADO - VALIDAR ROLES
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
        console.error("Error al recuperar roles:", e);
    }

    if (userRoles.length === 0) { logout(); return; }

    if (requiredRoles.length > 0) {
        const hasRequiredRole = requiredRoles.some(r => userRoles.includes(r));
        if (!hasRequiredRole) {
            window.location.replace(window.location.origin); 
            return;
        }
    }

    // 3. MOSTRAR INTERFAZ (Sin parpadeos)
    // Primero ocultamos el login por completo
    if(loginScreen) loginScreen.style.display = 'none';
    
    // Mostramos el contenido solo cuando ya sabemos que todo es correcto
    if(protectedContent) {
        protectedContent.style.display = 'block';
    }
    
    if(logoutButton) logoutButton.style.display = 'inline-block';

    // Manejo de visibilidad de menús según roles
    const isAdmin = userRoles.includes('admin');
    const isSuperMan = userRoles.includes('super_man');
    const isSuper = userRoles.includes('super');
    
    const canSeeKpis = isAdmin || isSuperMan || isSuper;
    const canSeeAdmin = isAdmin || isSuperMan;

    const kpisLink = document.getElementById('link-kpis');
    const dashLink = document.getElementById('link-dashboard-ajustes');
    const adminLink = document.getElementById('link-admin-mantenimiento');

    if (kpisLink) kpisLink.style.display = canSeeKpis ? 'block' : 'none';
    if (dashLink) dashLink.style.display = canSeeKpis ? 'block' : 'none';
    if (adminLink) adminLink.style.display = canSeeAdmin ? 'block' : 'none';
};