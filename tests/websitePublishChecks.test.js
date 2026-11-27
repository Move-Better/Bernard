import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkMoveBetterBlog, oldSiteLinks, websiteByline } from '../api/_lib/websitePublishChecks.js'

const noAlt = async () => ''

describe('movebetter.co publish rules', () => {
  it('rejects old-site links and keeps current ones', () => {
    expect(oldSiteLinks('[a](https://www.movebetter.co/mps/) [b](https://movebetter.co/team-members/) [c](/function-over-structure/)')).toEqual([
      'https://www.movebetter.co/mps/',
      'https://movebetter.co/team-members/',
      '/function-over-structure/',
    ])
    expect(oldSiteLinks('[a](https://movebetter.co/method#scoring) [b](/go-deeper/x) see https://www.movebetter.co. [c](https://movebetter.janeapp.com/) [d](https://www.movebetter.com/x)')).toEqual([])
  })

  it('writes the byline as Dr. [first name] and leaves non-doctors alone', () => {
    expect(websiteByline('Zach Cullen')).toBe('Dr. Zach')
    expect(websiteByline('Dr. Zachary Cullen')).toBe('Dr. Zach')
    expect(websiteByline('Sophie Kaplan')).toBe('Dr. Sophie')
    expect(websiteByline('Dr. Q')).toBe('Dr. Q')
    expect(websiteByline('Alli Madsen')).toBe('Alli Madsen')
  })

  it('rejects a full doctor name in the text', async () => {
    const issues = await checkMoveBetterBlog({ markdown: 'As Dr. Zachary Cullen puts it' }, { lookupAlt: noAlt })
    expect(issues.join(' ')).toContain('Dr. Zachary Cullen')
    expect(await checkMoveBetterBlog({ markdown: 'As Dr. Zach puts it' }, { lookupAlt: noAlt })).toEqual([])
  })

  it('takes the hero alt from the media library, and rejects when there is none', async () => {
    const payload = { markdown: 'x', heroImageAlt: 'DSC07186.jpeg' }
    expect(await checkMoveBetterBlog(payload, { lookupAlt: async () => 'A doctor coaching a hinge' })).toEqual([])
    expect(payload.heroImageAlt).toBe('A doctor coaching a hinge')
    const bare = { markdown: 'x', heroImageAlt: 'DSC07186.jpeg' }
    expect((await checkMoveBetterBlog(bare, { lookupAlt: noAlt })).join(' ')).toContain('DSC07186.jpeg')
  })

  it('rejects a file name used as an inline picture description', async () => {
    const issues = await checkMoveBetterBlog({ markdown: '![IMG_1.png](https://x/y.png)' }, { lookupAlt: noAlt })
    expect(issues).toHaveLength(1)
  })

  it('the publish route runs the rules for the Move Better workspace only', () => {
    const route = readFileSync(new URL('../api/publish/website.js', import.meta.url), 'utf8')
    expect(route).toContain('if (workspaceSlug === MOVE_BETTER_WEBSITE_SLUG) {')
    expect(route.match(/checkMoveBetterBlog\(payload/g)).toHaveLength(1)
  })
})
