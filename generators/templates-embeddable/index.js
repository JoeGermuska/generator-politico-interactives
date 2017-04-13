const Generator = require('yeoman-generator');
const mkdirp = require('mkdirp');
const fs = require('fs');
const S = require('string');

module.exports = class extends Generator {
  constructor(args, opts) {
    super(args, opts);

    this.option('title', {
      type: String,
      required: true,
      desc: 'Project title',
    });

    this.option('webpack', {
      type: Boolean,
      required: false,
      default: false,
      desc: 'Use webpack module bundler',
    });
  }

  initializing() {
    switch (this.options.webpack) {
      case true:
        this.composeWith(require.resolve('../bundler-webpack'), {
          embed: true,
        });
        break;
      default:
        this.composeWith(require.resolve('../bundler-browserify'), {
          embed: true,
        });
    }
  }

  writing() {
    // Skeleton
    mkdirp('./src');
    mkdirp('./dist');
    // Nunjucks templates
    this.fs.copyTpl(
      this.templatePath('src/templates/index.html'),
      this.destinationPath('src/templates/index.html'),
      { title: this.options.title });
    this.fs.copyTpl(
      this.templatePath('src/templates/base.html'),
      this.destinationPath('src/templates/base.html'),
      {
        cssInclude: !this.options.webpack, // Don't include script tags for webpack
        jsInclude: !this.options.webpack, // which injects them automatically.
      });
    this.fs.copyTpl(
      this.templatePath('dist/embed.html'),
      this.destinationPath('dist/embed.html'), {
        slug: S(this.options.title).slugify().s,
      });
    // Images directory
    mkdirp('./src/images');
    mkdirp('./src/images/opt');
  }

  end() {
    const nunjucksTask = this.spawnCommand('gulp', ['nunjucks']);
    nunjucksTask.on('close', () => {
      // Copy the rendered template over initially
      fs.createReadStream('./src/index.html').pipe(fs.createWriteStream('./dist/index.html'));
      const imgTask = this.spawnCommand('gulp', ['img']);
      imgTask.on('close', () => {
        this.spawnCommand('gulp');
      });
    });
  }
};
