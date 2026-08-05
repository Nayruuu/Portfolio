Esta aplicación solo tiene un único store. Todo el resto de su estado vive en `signal()` locales,
en el fondo de los componentes que los poseen. El store existe únicamente para el dato que escapa a
un componente: el idioma activo y el árbol de contenido que este resuelve.

Este dato se lee en todas partes (cada título, cada etiqueta, cada breadcrumb lo consulta), se
deriva en las vistas que recalculan a partir de él, y se muta desde dos sitios (el resolver de ruta
y el arranque). Esa es la descripción del puesto de un store. **NgRx SignalStore**
(`@ngrx/signals`) lo cubre sin las actions ni los reducers del NgRx clásico: signals de solo
lectura como salida, métodos como entrada.

## Componer features

Un `signalStore` se ensambla a partir de features encadenadas. `withState` declara la forma y el
estado inicial, `withComputed` los valores derivados, `withMethods` las operaciones. Cada campo de
estado se convierte en un signal expuesto en la instancia: declarar `lang` produce `store.lang`,
un `Signal<Lang>` que cualquier componente puede leer.

El store de contenido tiene tres campos: `lang`, `content`, `loading`.

El estado nunca se muta directamente. Se pasa por `patchState`, que aplica una actualización
inmutable y solo notifica a los signals cuyo valor ha cambiado. `loading` puede cambiar sin volver
a renderizar nada que dependa de `content`.

Este store no usa `withComputed`. Sus valores derivados (un título de página, un breadcrumb, una
lista de artículos filtrada) son propios de cada pantalla, así que viven en los componentes que
los muestran, no en el estado compartido. La regla que se desprende: centraliza solo lo que
varias vistas derivan de forma idéntica.

## Construir el estado en un contexto de inyección

`withState` acepta dos formas: un objeto literal, o una fábrica que lo devuelve. La fábrica se
ejecuta en el contexto de inyección del store, lo que le permite hacer `inject()` de un servicio y
leer `localStorage` en el momento de la construcción.

```typescript
export const ContentStore = signalStore(
  { providedIn: 'root' },
  withState<ContentState>(() => {
    const lang = readInitialLang();

    // Seed content synchronously so first paint + prerender already have the right locale.
    return { lang, content: inject(ContentApiService).peek(lang), loading: false };
  }),
  // withMethods / withHooks below
);
```

`readInitialLang` lee la preferencia persistida, la valida como `Lang`, y recae en el idioma por
defecto si `localStorage` no está disponible o lanza una excepción. Deliberadamente, no hay
ningún sniffing de `navigator.language`: el prerender nativo y los tests arrancan en un idioma
determinista, nunca en el de la máquina que construye. Es una decisión que se paga en otro sitio
(un primer render SSG siempre en francés) pero que mantiene la generación estática reproducible.

## Stale-while-revalidate, en concreto

El store muestra un valor conocido de inmediato, y luego va a verificar por detrás. Dos métodos
del servicio de contenido sostienen este contrato.

`peek(lang)` devuelve el valor en caché de forma síncrona: es el que arranca el estado, para que
el primer render y la generación estática ya tengan contenido. `getContent(lang)` hace el fetch
asíncrono, la llamada de red real a la larga.

Hoy este servicio es un mock sobre el contenido embebido en el bundle. Es el único punto de
costura entre la app y «de dónde viene el contenido»: el día que una API .NET sirva los locales,
es el único archivo que cambia.

```typescript
export const FETCH_DELAY_MS = 300;

public peek(lang: Lang): Content {
  return this.bundled[lang];
}

public getContent(lang: Lang): Promise<Content> {
  // Mock: a real client would fetch(this.contentUrl(lang)); we serve bundled content after a delay.
  return new Promise((resolve) => setTimeout(() => resolve(this.peek(lang)), FETCH_DELAY_MS));
}
```

Ante un cambio de idioma, `setLang` primero intercambia el contenido mediante `peek` (síncrono, así
que el próximo render ya está en el locale correcto), y luego lanza la revalidación. La bandera
`loading` pasa a `true` mientras dura el fetch, lo que permite que una vista muestre un estado de
carga durante la transición.

El diccionario `bundled` está tipado como `Record<Lang, Content>`. Añadir un idioma al conjunto de
valores `LANG` deja de compilar mientras su bundle no esté conectado aquí. El compilador mantiene
la lista al día.

## Cancelar un resultado obsoleto

En cuanto un método es asíncrono, dos llamadas pueden solaparse. Un visitante cambia a inglés, y
luego a alemán antes de que el inglés haya vuelto. Sin una guarda, el resultado en inglés llegaría
el último y sobrescribiría el alemán.

`reload` se protege con un last-wins: antes de aplicar un resultado, verifica que el idioma actual
sigue siendo el que había solicitado.

```typescript
const reload = async (lang: Lang): Promise<void> => {
  patchState(store, { loading: true });
  const content = await api.getContent(lang);

  // Last-wins: a newer language switch has moved store.lang() on; drop this stale result.
  if (store.lang() === lang) {
    patchState(store, { content, loading: false });
  }
};
```

Un test blinda este comportamiento: lanza un `reload('en')` mientras el store permanece en `fr`,
avanza el tiempo simulado en `FETCH_DELAY_MS`, y verifica que el contenido final sigue siendo `FR`.
El resultado en inglés se descarta correctamente.

## Un efecto dentro del store

`withHooks` le da al store un ciclo de vida. Su `onInit` se ejecuta en el contexto de inyección del
store, lo que le permite abrir un `effect`.

```typescript
withHooks({
  onInit(store) {
    const doc = inject(DOCUMENT);

    // Revalidate the seeded content once at startup.
    void store.reload(store.lang());

    // Persist the language and reflect it on <html lang="…"> reactively.
    effect(() => {
      const lang = store.lang();

      try {
        localStorage.setItem(STORAGE_KEYS.LANG, lang);
      } catch {
        /* localStorage unavailable */
      }
      doc.documentElement.setAttribute('lang', lang);
    });
  },
});
```

El efecto depende de `store.lang()`. En cada cambio, vuelve a persistir la preferencia y actualiza
el atributo `lang` de `<html>`, el que leen los lectores de pantalla y los motores de búsqueda. La
escritura en `localStorage` está envuelta en un `try` que absorbe el error: una cuota llena no debe
romper el render. Un test lo verifica haciendo que `setItem` lance una excepción, asegurándose de
que el `tick` no la propague, y de que `<html lang>` se actualice de todas formas.

Como el efecto nace en el contexto del store, se limpia junto con él. No hay ningún `Subscription`
que deshacer a mano.

## Una fachada por encima del store

Ningún componente inyecta `ContentStore` directamente. Pasan por `I18nService`, una fachada que
solo reexpone cuatro cosas: `lang`, `content`, `loading`, `setLang`.

```typescript
@Injectable({ providedIn: 'root' })
export class I18nService {
  public readonly lang: Signal<Lang>;
  public readonly content: Signal<Content>;
  public readonly loading: Signal<boolean>;

  private readonly store = inject(ContentStore);

  constructor() {
    this.lang = this.store.lang;
    this.content = this.store.content;
    this.loading = this.store.loading;
  }

  public setLang(lang: Lang): void {
    this.store.setLang(lang);
  }
}
```

La superficie es estable. Si el store gana un campo interno o cambia su composición de features,
las decenas de componentes que leen el idioma no se mueven. Dependen de un contrato, no de una
forma.

El cambio de idioma se dispara desde la URL, nunca mediante una llamada directa. El selector de
idioma navega a la misma página con otro prefijo (`/fr`, `/en`, …). Es el resolver de ruta el que
llama a `setLang` a partir de ese prefijo, antes de que el componente se renderice. La URL sigue
siendo la única fuente de verdad para el idioma: un enlace compartido hacia `/de/articles` abre la
página en alemán sin que haya ningún estado que sincronizar a mano.

## El umbral del store

No todo necesita un store, y esta app lo demuestra teniendo solo uno. Una pestaña activa, la
apertura de un menú: eso se queda en un `signal()` privado en el componente. Añadirle un store
solo aportaría indirección.

El SignalStore se justifica cuando el estado cumple las condiciones que cumple el idioma aquí:
compartido entre varias pantallas, derivado por vistas que recalculan a partir de él, mutado por
operaciones que se quieren testear aparte. El last-wins, la persistencia, el seed síncrono se
testean cada uno de forma aislada, sin montar un componente.

En la práctica: empieza con signals locales, extrae un store el día en que copiarías el mismo
estado en un segundo componente. La [guía de SignalStore](https://ngrx.io/guide/signals/signal-store)
detalla cada feature, incluido `rxMethod` (que este store no usa: un `async`/`await` bastaba para
orquestar un único fetch).

> Un SignalStore es una fachada de signals: solo lectura como salida, métodos como entrada, cero
> reducers. Se mantiene la disciplina de un store, y su ciclo de vida, sin el ceremonial de las
> actions del NgRx de ayer.
