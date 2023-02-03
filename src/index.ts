import { PluginMeta, PluginEvent, CacheExtension, RetryError, Properties, Plugin } from '@posthog/plugin-scaffold'
import type { RequestInfo, RequestInit, Response } from 'node-fetch'
import { createBuffer } from '@posthog/plugin-contrib'
import { URL } from 'url'

export interface EventSink {
    salesforcePath: string
    propertiesToInclude: string
    method: string
}

export type EventToSinkMapping = Record<string, EventSink>

export const parseEventSinkConfig = (config: SalesforcePluginConfig): EventToSinkMapping | null => {
    let eventMapping: EventToSinkMapping | null = null
    if (config.eventEndpointMapping?.length > 0) {
        try {
            eventMapping = JSON.parse(config.eventEndpointMapping) as EventToSinkMapping
        } catch (e) {
            throw new Error('eventEndpointMapping must be an empty string or contain valid JSON!')
        }
    }
    return eventMapping
}

interface Logger {
    error: typeof console.error
    log: typeof console.log
    debug: typeof console.debug
}

const makeLogger = (debugLoggingOn: boolean): Logger => {
    return {
        error: console.error,
        log: console.log,
        debug: debugLoggingOn
            ? console.debug
            : () => {
                  /* no-op debug logging */
              },
    }
}

// fetch only declared, as it's provided as a plugin VM global
declare function fetch(url: RequestInfo, init?: RequestInit): Promise<Response>

const CACHE_TOKEN = 'SF_AUTH_TOKEN_'
const CACHE_TTL = 60 * 60 * 5 // in seconds

export interface SalesforcePluginConfig {
    salesforceHost: string
    eventPath: string
    eventMethodType: string
    username: string
    password: string
    consumerKey: string
    consumerSecret: string
    eventsToInclude: string
    propertiesToInclude: string
    debugLogging: string
    eventEndpointMapping: string
}

export interface SalesforcePluginGlobal {
    buffer: ReturnType<typeof createBuffer>
    logger: Logger
}

type SalesForcePlugin = Plugin<{
    cache: CacheExtension
    config: SalesforcePluginConfig
    global: SalesforcePluginGlobal
}>

export type SalesforcePluginMeta = PluginMeta<SalesForcePlugin>

const validateEventSinkConfig = (config: SalesforcePluginConfig): void => {
    const eventMapping = parseEventSinkConfig(config)

    if (eventMapping !== null) {
        Object.entries(eventMapping).map((entry) => {
            const eventSink = entry[1]
            if (eventSink.salesforcePath == null || eventSink.salesforcePath.trim() === '') {
                throw new Error('You must provide a salesforce path for each mapping in config.eventEndpointMapping.')
            }
            if (eventSink.method == null || eventSink.method.trim() === '') {
                throw new Error('You must provide a method for each mapping in config.eventEndpointMapping.')
            }
        })
    } else {
        // if no eventMapping is provided then we still need to receive eventsToInclude
        if (!config.eventsToInclude) {
            throw new Error('If you are not providing an eventEndpointMapping then you must provide events to include.')
        }
        if (!config.eventPath) {
            throw new Error(
                'If you are not providing an eventEndpointMapping then you must provide the salesforce path.'
            )
        }
    }
    // don't send v1 and v2 mapping
    if (eventMapping !== null && !!config.eventsToInclude?.trim()) {
        throw new Error('You should not provide both eventsToInclude and eventMapping.')
    }
}

export function verifyConfig({ config }: SalesforcePluginMeta): void {
    validateEventSinkConfig(config)

    if (!config.salesforceHost) {
        throw new Error('host not provided!')
    }

    try {
        new URL(config.salesforceHost)
    } catch (error) {
        throw new Error('host not a valid URL!')
    }

    if (!config.salesforceHost.startsWith('http')) {
        throw new Error('host not a valid URL!')
    }

    if (!config.username) {
        throw new Error('Username not provided!')
    }

    if (!config.password) {
        throw new Error('Password not provided!')
    }
}

const callSalesforce = async ({
    host,
    sink,
    token,
    event,
    logger,
}: {
    host: string
    sink: EventSink
    token: string
    event: PluginEvent
    logger: Logger
}): Promise<void> => {
    const response = await fetch(`${host}/${sink.salesforcePath}`, {
        method: sink.method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(getProperties(event, sink.propertiesToInclude)),
    })

    const isOk = await statusOk(response, logger)
    if (!isOk) {
        throw new Error(`Not a 200 response from event hook ${response.status}. Response: ${response}`)
    }
}

export async function sendEventToSalesforce(
    event: PluginEvent,
    meta: SalesforcePluginMeta,
    token: string
): Promise<void> {
    try {
        const { config, global } = meta

        global.logger.debug('processing event: ', event?.event)

        const eventMapping = parseEventSinkConfig(config)

        let eventSink: EventSink
        if (eventMapping !== null) {
            const hasMappingForThisEvent = event.event in eventMapping

            if (!hasMappingForThisEvent || !event.properties) {
                return
            }

            eventSink = eventMapping[event.event]
            global.logger.debug('v2: processing event: ', event?.event, ' with sink ', eventSink)
        } else {
            const eventsToInclude = config.eventsToInclude.split(',').map((e) => e.trim())
            if (!eventsToInclude.includes(event.event)) {
                return
            }

            eventSink = {
                salesforcePath: config.eventPath,
                method: config.eventMethodType,
                propertiesToInclude: config.propertiesToInclude,
            }
            global.logger.debug('v1: processing event: ', event?.event, ' with sink ', eventSink)
        }

        return callSalesforce({
            host: config.salesforceHost,
            sink: eventSink,
            token,
            event,
            logger: global.logger,
        })
    } catch (error) {
        meta.global.logger.error('error while sending event to salesforce. event: ', event, ' the error was ', error)
        throw error
    }
}

async function getToken(meta: SalesforcePluginMeta): Promise<string> {
    const { cache } = meta
    const token = await cache.get(CACHE_TOKEN, null)
    if (token == null) {
        await generateAndSetToken(meta)
        return await getToken(meta)
    }
    return token as string
}

async function generateAndSetToken({ config, cache, global }: SalesforcePluginMeta): Promise<string> {
    const details: Record<string, string> = {
        grant_type: 'password',
        client_id: config.consumerKey,
        client_secret: config.consumerSecret,
        username: config.username,
        password: config.password,
    }

    const formBody = []
    for (const property in details) {
        const encodedKey = encodeURIComponent(property)
        const encodedValue = encodeURIComponent(details[property])
        formBody.push(encodedKey + '=' + encodedValue)
    }

    const tokenURL = `${config.salesforceHost}/services/oauth2/token`
    global.logger.debug('getting token from ', tokenURL)
    const response = await fetch(tokenURL, {
        method: 'post',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.join('&'),
    })

    if (!statusOk(response, global.logger)) {
        throw new Error(`Got bad response getting the token ${response.status}`)
    }
    const body = await response.json()
    cache.set(CACHE_TOKEN, body.access_token, CACHE_TTL)
    return body.access_token
}

export async function setupPlugin(meta: SalesforcePluginMeta): Promise<void> {
    const { global } = meta

    const debugLoggingOn = meta.config.debugLogging === 'debug logging on'
    global.logger = makeLogger(debugLoggingOn)

    verifyConfig(meta)

    try {
        await getToken(meta)
    } catch (error) {
        global.logger.error('error in getToken', error)
        throw new RetryError('Failed to getToken. cache or salesforce is unavailable')
    }

    global.buffer = createBuffer({
        limit: 1024 * 1024, // 1 MB
        timeoutSeconds: 1,
        onFlush: async (events) => {
            for (const event of events) {
                await sendEventToSalesforce(event, meta, await getToken(meta))
            }
        },
    })
}

function configToMatchingEvents(config: SalesforcePluginConfig): string[] {
    if (config.eventsToInclude) {
        return config.eventsToInclude.split(',').map((e: string) => e.trim())
    } else {
        return Object.keys(JSON.parse(config.eventEndpointMapping)).map((e: string) => e.trim())
    }
    return []
}

export async function onEvent(event: PluginEvent, { global, config }: SalesforcePluginMeta): Promise<void> {
    if (!global.buffer) {
        throw new Error(`There is no buffer. Setup must have failed, cannot process event: ${event.event}`)
    }

    const eventsToMatch = configToMatchingEvents(config)
    if (!eventsToMatch.includes(event.event)) {
        return
    }

    const eventSize = JSON.stringify(event).length
    global.buffer.add(event, eventSize)
}

export function teardownPlugin({ global }: SalesforcePluginMeta): void {
    global.buffer.flush()
}

async function statusOk(res: Response, logger: Logger): Promise<boolean> {
    logger.debug('testing response for whether it is "ok". has status: ', res.status, ' debug: ', JSON.stringify(res))
    return String(res.status)[0] === '2'
}

export function getProperties(event: PluginEvent, propertiesToInclude: string): Properties {
    // Spreading so the TypeScript compiler understands that in the
    // reducer there's no way the properties will be undefined
    const { properties } = event

    if (!properties) {
        return {}
    }

    if (!propertiesToInclude?.trim()) {
        return properties
    }

    const allParameters = propertiesToInclude.split(',')
    const propertyKeys = Object.keys(properties)

    return allParameters.reduce<Record<string, unknown>>((acc, currentValue) => {
        const trimmedKey = currentValue.trim()

        if (propertyKeys.includes(trimmedKey)) {
            acc[trimmedKey] = properties[trimmedKey]
        }

        return acc
    }, {})
}
