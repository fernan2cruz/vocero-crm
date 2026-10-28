# S8 — Configuración de plataforma

Revisión de Claude contra PostgreSQL y navegador. Usar una base descartable,
`PLATAFORMA=on`, credenciales de arranque válidas, un superadmin y un miembro de
un negocio. Meta y los proveedores se sustituyen por los mocks existentes.
No usar secretos reales en capturas, trazas o informes. Restaurar el entorno al terminar.

1. Aplicar las migraciones desde una instalación con 0032. Confirmar que 0033
   crea solo `platform_config`, conserva `organization_limits` y registra el journal.
2. Sin META_WEBHOOK_VERIFY_TOKEN ni META_APP_SECRET en el entorno, arrancar.
   Abrir `/platform/configuracion`: pendientes Meta e IA, token «Autogenerado».
   Copiar URL y token y verificar el handshake de WhatsApp. La entrega sin App
   secret responde 503. Los datos completos se ven solo como superadmin.
3. Reiniciar: mismo token y URL. Vaciar solo esa fila en una base de pruebas y
   arrancar dos procesos simultáneos: ambos usan el token de la única fila.
4. Guardar un App secret ficticio: el formulario no lo trae rellenado, usa
   password/new-password, y después solo enseña sus últimos cuatro. Consultar
   `platform_config`: value_plain es NULL y cipher/iv/tag están presentes.
   GET/PUT/DELETE del catálogo, auditoría y errores nunca contienen el secreto.
5. Firmar un webhook con ese secreto: 200 y procesamiento habitual; sin firma
   o con otra firma: 401. Repetir con Meta Instagram/Messenger tras habilitarlos.
6. Fijar un respaldo distinto en el entorno y reiniciar: DB gana. «Quitar»
   con confirmación vuelve al entorno. Quitar sin respaldo del token genera
   otro y obliga a actualizar el registro del webhook en Meta.
7. Cambiar registro público, agenda, atribución, canales, retención y versión
   Graph: se aplican sin reiniciar. En un segundo proceso, esperar 30 s y
   comprobar refresco. Modificar las bases avanzadas hacia los mocks y verificar
   que las siguientes llamadas usan los hosts nuevos.
8. Probar valores inválidos por API (entero negativo, booleano texto, canal
   desconocido, versión incorrecta, URL con credenciales): 422 sin repetir
   valores. Claves fuera del catálogo: 404; ENCRYPTION_KEY nunca es editable.
9. Como miembro, página/API de plataforma: 404. Sin sesión, API: 401.
   `/api/settings/webhook` como miembro responde solo `{gestionado:true}`.
10. Con BD caída al calentar, el proceso sigue y utiliza entorno/default;
    el log es fijo, sin error del driver. Recuperar BD y verificar refresco.
    Sin App secret en ningún origen, una entrega autenticada por URL sigue
    devolviendo 503. Sin verify token disponible, la ruta no autentica (404).
11. Con `PLATAFORMA` apagada, cero consultas a `platform_config`, portal/API
    404 y comportamiento histórico del negocio y de las banderas por entorno.
12. Navegador a 375 px y escritorio, temas claro/oscuro: sin desbordes; recorrer
    con teclado, abrir/cerrar diálogos, comprobar foco, errores accesibles,
    copiar URL/token y cancelar «Quitar» sin cambios.

No se ejecuta aquí por el acuerdo de trabajo sin red/Docker: los unitarios
simulan la BD y el transporte; esta revisión verifica SQL, carreras reales y UI.
