### Note on sorting and order:

To understand how the articles shift around when using the solution, we need to distinguish between two completely different modes in our search engine. 

Your code and behavior is split in two based on whether the search field is empty or not.

Here is a simple explanation of how the two sorting methods work in practice:

### 1. Default Mode (When the search field is EMPTY)

When you haven't typed anything into the search field, the order is guided by a structured, logical learning path (alphabetical, numbered etc.) 

Sorting happens in two stages: First by Track (Category): The code groups the articles alphabetically by the track they belong to (e.g., managers, researchers, trainers).

Then by order (Sequence): Within each group, the modules are sorted according to your numerical order field (e.g., 1, 2, 3).Why does it do this?This ensures that the course material and modules are arranged in a pedagogical sequence (e.g., Introduction to Step 1 to Step 2). 

This logic is also what allows your code to automatically find the "Next Module" by looking for an article in the same track with an order + 1 value.


### 2. Search Mode (When you TYPE in the search field).

As soon as you type a word into the search field, the default mode turns off completely. The learning path and the order numbers are entirely ignored. Instead, results are sorted by relevance (how well the search term matches the title):

Your code assigns points (scoring) based on where your search term appears:3 points (Highest relevance): If the article title matches the exact word you searched for.2 points (Medium relevance): If the article title starts with the word you searched for.1 point (Lowest relevance): If the word is found anywhere inside the title text, inside the abstract (summary), or among the tags.In case of a tie (Equal score):If two articles get the exact same score (for example, if both contain the search term right in the middle of their abstracts), the code falls back on sorting the titles alphabetically (titleA.localeCompare(titleB)) to determine which one comes first.


### Markdown files in the folder named articles are the basis for the content.
The words in a title and abstract and tags (defined in the file index.json) are the basis for the search function and the "front page". 
markdown-it is the basis for parsing markdown into html, used together also with the styling from the css file and javascript code in the app.js file. 
This solution will run on any web server.

comments that needs translation in app.js: 
Lines 391-392: Search threshold explanation
Line 396: Filter execution note
Line 404: Normal search explanation
Line 491: Reset color removal
Lines 650, 653, 656: Reset button sync function comments


## The use of Markdown-it is in this solution based on the original MIT License for the markdown-it javascript:

https://github.com/markdown-it/markdown-it?tab=MIT-1-ov-file 

"Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE."


