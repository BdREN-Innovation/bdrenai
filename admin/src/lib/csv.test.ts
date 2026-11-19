import { describe, expect, it } from 'vitest';
import { csvToImportRows, parseCsv, toCsv } from './csv';
import { parseDomains, slugify } from './slug';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF and blank lines', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n\r\nf,g,h\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['f', 'g', 'h'],
    ]);
  });
});

describe('csvToImportRows', () => {
  it('follows a header row in any column order and defaults the role', () => {
    expect(csvToImportRows('Name,Email\nRahim,rahim@du.ac.bd\n')).toEqual([{ email: 'rahim@du.ac.bd', name: 'Rahim', role: 'member' }]);
  });

  it('reads email, name, role without a header', () => {
    expect(csvToImportRows('﻿a@x.edu,A,Admin\nb@x.edu')).toEqual([
      { email: 'a@x.edu', name: 'A', role: 'admin' },
      { email: 'b@x.edu', name: '', role: 'member' },
    ]);
  });
});

describe('slug helpers', () => {
  it('slugifies names', () => {
    expect(slugify('  Dhaka University (Main) ')).toBe('dhaka-university-main');
  });

  it('parses and validates sign-in domains', () => {
    expect(parseDomains('du.ac.bd, @EXAMPLE.edu  nope')).toEqual({ domains: ['du.ac.bd', 'example.edu'], invalid: ['nope'] });
  });
});

describe('toCsv', () => {
  it('quotes cells with commas, quotes and newlines', () => {
    expect(toCsv([['a', 'b,c'], ['say "hi"', 'two\nlines']])).toBe('a,"b,c"\r\n"say ""hi""","two\nlines"');
  });
});
