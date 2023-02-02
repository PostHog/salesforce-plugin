import { SalesforcePluginConfig, SalesforcePluginMeta, verifyConfig } from '.'

describe('config validation', () => {
    let config: SalesforcePluginConfig

    beforeEach(() => {
        config = {
            salesforceHost: '',
            eventPath: '',
            eventMethodType: '',
            username: '',
            password: '',
            consumerKey: '',
            consumerSecret: '',
            eventsToInclude: '',
            propertiesToInclude: '',
            debugLogging: '',
        }
    })

    it('rejects an invalid URL', () => {
        config.salesforceHost = 'not a url'
        expect(() => verifyConfig({ config } as SalesforcePluginMeta)).toThrowError('host not a valid URL!')
    })

    it('accepts a valid URL', () => {
        config.salesforceHost = 'http://bbc.co.uk'
        expect(() => verifyConfig({ config } as SalesforcePluginMeta)).not.toThrowError('host not a valid URL!')
    })

    it('rejects an FTP URL', () => {
        config.salesforceHost = 'ftp://bbc.co.uk'
        expect(() => verifyConfig({ config } as SalesforcePluginMeta)).toThrowError('host not a valid URL!')
    })
})
