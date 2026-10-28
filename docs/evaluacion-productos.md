# Evaluación: catálogo de productos por negocio

Fecha: 2026-10-28. Evaluación sobre `feat/066-marca-wassapi`; no es una feature
implementada ni una especificación ratificada. Antes de programarla corresponde
el ciclo completo de specs: requiere modelo de datos y contrato para el cerebro.

## Decisión propuesta

Sí conviene un catálogo pequeño que permita al negocio cargar y actualizar lo
que vende, y al agente consultar productos y precios vigentes. Ayuda a atender
y convertir conversaciones, dentro del foco del CRM. El catálogo pertenece al
negocio; el superadmin administra acceso y límites, sin tener que editar cada
producto de sus clientes.

La primera versión debe ser un catálogo consultable, con carga manual y CSV.
Inventario, pedidos, pagos y sincronización con tiendas requieren decisiones
y garantías adicionales; no son necesarios para resolver esta necesidad.

## Qué existe y qué falta

`kb_entry` guarda preguntas/respuestas o bloques de texto. `renderKb()` los
concatena y `serializeBotProfile()` entrega ese texto al cerebro. No hay una
tabla de productos, SKU único por negocio, precio tipado ni búsqueda de catálogo.
`resources` existe como lista vacía en el perfil; no representa productos.

La ficha del lead describe al cliente y las ventas registran valor comercial:
ninguna debe reutilizarse como catálogo. La infraestructura reutilizable es
Postgres/Drizzle, `scoped()`, Zod, el adaptador de medios, la importación CSV,
el perfil del agente y la API `/api/bot/*` con credencial por organización.

| Alternativa | Beneficio | Límite |
|---|---|---|
| Productos como bloques de conocimiento | No exige un módulo nuevo; útil para validar un catálogo mínimo a mano | No valida precios/SKU, dificulta actualizar y deduplicar; todo el texto viaja al cerebro |
| Catálogo estructurado local | Precio y disponibilidad explícitos, importación repetible, búsqueda acotada y aislamiento verificable | Exige tablas, UI, contrato del bot y cambios coordinados en Nea |
| Sincronizar con tienda/ERP externo | Puede evitar la doble edición cuando ese sistema ya es la fuente de verdad | Añade credenciales, reintentos y resolución de conflictos; solo admisible como conector opcional |

Recomendación: catálogo estructurado local. El conocimiento conserva políticas
generales y contexto; no debe guardar una segunda copia editable de los precios.

## Experiencia de primera versión

El propietario o administrador abre Productos, crea un artículo y decide si
está publicado. Puede buscar, editar y archivar. El miembro consulta el catálogo;
la edición se autoriza en el servidor con los roles actuales mientras no exista
el catálogo de permisos. No se deja el control solo en botones ocultos.

Cada producto presenta nombre, SKU, descripción, precio con moneda y estado
de disponibilidad declarado. Un precio ausente significa «consultar»; nunca se
convierte en cero. Disponibilidad declarada tampoco significa stock reservado.
Una imagen opcional se guarda con el adaptador existente de medios y pasa por
los mismos límites de tamaño/tipo; no se descarga cualquier URL del CSV.

La carga CSV muestra vista previa, errores por fila y resumen antes de guardar.
Repetir la misma carga no duplica SKU; cada fila se actualiza por la pareja
organización/SKU. Deben definirse el máximo de filas y el comportamiento de
actualización parcial. Un archivo con errores no debe producir cambios ocultos.

## Modelo candidato

Tabla `producto`: id, `organization_id NOT NULL`, SKU normalizado, nombre,
descripción, importe entero en unidades menores, moneda, disponibilidad
(`disponible`, `agotado`, `consultar`), publicación, medio opcional y fechas.
Índice único `(organization_id, sku_normalizado)` e índices org-first para
publicación/búsqueda. Archivar mantiene referencias comerciales anteriores.

No usar `number` decimal para dinero ni confundir las unidades menores del
catálogo con los microdólares de crédito de IA. La moneda y su escala deben
validarse al entrar; el primer alcance puede limitarse explícitamente a las
monedas del negocio que el producto soporte. Variantes complejas y precios
por cliente quedarían fuera.

La migración se genera desde `schema.ts`, es aditiva y se verifica sobre una
instalación anterior. Si se elige una bandera opcional de catálogo, apagada
oculta navegación y devuelve 404 en todas sus superficies, sin exigir terceros.
No se introduce un SDK, buscador externo o base vectorial en el núcleo.

## Consulta desde el agente

El CRM continúa sin pensar ni responder por sí mismo. El cerebro consulta un
endpoint nuevo y acotado, por ejemplo `GET /api/bot/products?q=…&limit=…`, y recibe
solo productos publicados de su organización. El nombre y forma definitivos
se fijan en la spec y OpenAPI antes de implementarlos. Conservar intacto el
perfil actual y añadir, si hace falta, una capacidad que cerebros antiguos
puedan ignorar.

La búsqueda puede empezar con comparación normalizada y SQL parametrizado;
los resultados necesitan orden determinista, límite y metadatos de actualización.
Antes de decidir índices o búsqueda de texto completo, medir con el volumen
de catálogo acordado. Un SKU exacto debe tener preferencia sobre coincidencias
vagas. No enviar el catálogo completo dentro de cada perfil o despacho.

Nea necesitará una herramienta de consulta y reglas para comunicar precio,
moneda y disponibilidad sin inventarlos. Si no hay coincidencias o el catálogo
falla, debe decirlo o escalar a una persona. El texto del producto es dato no
confiable: no puede sustituir instrucciones, activar herramientas ni cambiar
de negocio. La respuesta citada debería conservar el id/SKU consultado para
poder revisar de dónde salió una recomendación.

## Criterios antes de darlo por hecho

- Dos negocios pueden usar el mismo SKU; consultas, búsquedas, importaciones,
  imágenes y credenciales cruzadas nunca exponen productos del otro.
- Roles sin edición reciben el rechazo de la API aunque llamen directamente;
  el superadmin no se convierte en editor de productos de todos por omisión.
- Precio desconocido, cero válido, moneda inválida, producto agotado/archivado,
  SKU duplicado y CSV repetido tienen resultados explícitos y comprobables.
- Conservar historial si un precio cambia: una venta o cotización ya registrada
  no debe recalcularse desde el precio actual del catálogo.
- Navegador móvil/escritorio: crear, editar, importar, mostrar errores y
  archivar; consulta real desde Nea, con camino sin resultados y caída de BD.
- Laboratorio: personas que piden precio, comparan productos o solicitan un
  artículo inexistente; el juez comprueba que no se inventan precio ni stock.
- Despliegue existente migra sin pasos manuales; cuatro gates y E2E en verde.

## Entrega sugerida y decisiones pendientes

Primero acordar SKU obligatorio, monedas, máximo de productos/filas y quién
puede editar. Después escribir spec/plan/tasks/contratos, implementar el catálogo
manual y verificar aislamiento. Añadir CSV como segunda entrega y herramienta
de Nea como tercera, cada una con su flujo completo en vivo.

Reservas de stock, carrito, pedido, facturación, cobros y sincronización externa
quedan fuera de esta propuesta. No se promete una estimación de tiempo sin
definir esos límites. Los pendientes de seguridad de plataforma y recuperación
de campañas no desaparecen por añadir Productos y deben seguir su propio orden.
