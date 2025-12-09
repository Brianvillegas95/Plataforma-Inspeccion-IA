// netlify/functions/auth-callback.js
const axios = require('axios');

// Lee las variables de entorno de Netlify
const { 
    AUTH0_CLIENT_ID, 
    AUTH0_CLIENT_SECRET, 
    AUTH0_DOMAIN 
} = process.env;

exports.handler = async (event, context) => {
    // 1. Obtener el código de autorización de la URL de retorno
    const { code } = event.queryStringParameters;
    
    if (!code) {
        return {
            statusCode: 400,
            body: 'Error: No authorization code provided.'
        };
    }

    // 🛑 CORRECCIÓN: Usamos la URL sin barra final para evitar conflictos en el backend.
    const redirectUri = 'https://azor-calidad.netlify.app/auth-callback'; 

    try {
        // 2. Intercambiar el código por los tokens (ID Token y Access Token)
        const tokenResponse = await axios.post(`https://${AUTH0_DOMAIN}/oauth/token`, {
            grant_type: 'authorization_code',
            client_id: AUTH0_CLIENT_ID,
            client_secret: AUTH0_CLIENT_SECRET,
            code: code,
            redirect_uri: redirectUri,
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        const { id_token, access_token } = tokenResponse.data;

        // 3. Redireccionar al cliente, estableciendo una cookie de sesión.
        // La cookie es necesaria para que Netlify reconozca la sesión.
        
        // La URL final de redirección después del login exitoso.
        const finalRedirect = 'https://azor-calidad.netlify.app/'; 

        return {
            statusCode: 302,
            headers: {
                // 🛑 CORRECCIÓN FINAL: Removimos el flag 'Secure' para evitar que navegadores rechacen la cookie
                // Si el sitio no está en HTTPS estricto. (No remuevas HttpOnly)
                'Set-Cookie': `nf_jwt=${id_token}; Path=/; Max-Age=3600; HttpOnly`,
                
                // Redirige al home (/) para que Netlify revise la autenticación
                'Location': 'https://azor-calidad.netlify.app/',
                'Cache-Control': 'no-cache',
            },
            body: '',
        };

    } catch (error) {
        console.error('Error exchanging code:', error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            body: `Error: Failed to exchange code for tokens.`,
        };
    }
};