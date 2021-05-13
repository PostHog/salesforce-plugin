import { PluginMeta, PluginEvent } from '@posthog/plugin-scaffold'
import type { RequestInfo, RequestInit, Response } from 'node-fetch'

// fetch only declared, as it's provided as a plugin VM global
declare function fetch(url: RequestInfo, init?: RequestInit): Promise<Response>


const CACHE_TOKEN = 'SF_TOKEN'
const CACHE_TTL = 60 * 60 * 5 // in seconds
interface SalesforcePluginMeta extends PluginMeta {
    config: {
        salesforceHost: string
        eventPath: string
        eventMethodType: string
        username: string
        password: string
        consumerKey: string
        consumerSecret: string
        eventsToInclude: string
    }
}

function verifyConfig({ config }: SalesforcePluginMeta) {
    if (!config.salesforceHost) {
        throw new Error('host not provided!')
    }
    if (!config.username) {
        throw new Error('Username not provided!')
    }
    if (!config.password) {
        throw new Error('Password not provided!')
    }
    if (!config.eventsToInclude) {
        throw new Error('No events to include!')
    }
}

async function sendEventsToSalesforce(events: PluginEvent[], meta: SalesforcePluginMeta) {
   
    const { config } = meta

    const types = (config.eventsToInclude || '').split(',')
   
    const sendEvents = events.filter((e) => types.includes(e.event))
    if (sendEvents.length == 0) {
        return
    }
    const token = await getToken(meta)
    console.log("got a token", token)
    for (const e of sendEvents) {
        if (!e.properties) {
            continue
        }   
        console.log("Sending the evnet")
        await fetch(`${config.salesforceHost}/${config.eventPath}`,
        {   
            method: config.eventMethodType,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(e.properties),
        })
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

async function canPingSalesforce({ cache, config }: SalesforcePluginMeta): Promise<boolean> {
    const token = await cache.get(CACHE_TOKEN, null)
    if (token == null) {
        return false
    }
    // will see if we have access to the api
    const response = await fetch(`${config.salesforceHost}/services/data`,{
        method: 'get',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${token}` },
    })
    console.log(response.status)
    if (response.status < 200 || response.status > 299) {
        throw new Error(`Unable to ping salesforce. Status code ${response.status}`)
    }
    return true
}

async function generateAndSetToken({ config, cache }: SalesforcePluginMeta): Promise<string> {
    const details: Record<string,string> = {
        grant_type: 'password',
        client_id: config.consumerKey,
        client_secret: config.consumerSecret,
        username: config.username,
        password: config.password,
    };
    
    let formBody = [];
    for (let property in details) {
      var encodedKey = encodeURIComponent(property);
      var encodedValue = encodeURIComponent(details[property]);
      formBody.push(encodedKey + "=" + encodedValue);
    }
    
    const response = await fetch(`${config.salesforceHost}/services/oauth2/token`, {
        method: 'post',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.join("&"),
    })

    if(response.status < 200 || response.status > 299) {
        throw new Error(`Got bad response getting the token ${response.status}`)
    }
    const body = await response.json()
    cache.set(CACHE_TOKEN, body.access_token, CACHE_TTL)
    return body.access_token
}

export async function setupPlugin(meta: SalesforcePluginMeta) {
    verifyConfig(meta)
    if (canPingSalesforce(meta)) {
        return
    }
    await generateAndSetToken(meta)
}

export async function processEventBatch(events: PluginEvent[], meta: SalesforcePluginMeta) {
    await sendEventsToSalesforce(events, meta)
    return events
}
